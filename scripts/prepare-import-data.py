"""
One-off data-cleaning pass for the historical leave import (see
../../.claude/plans/cozy-soaring-mccarthy.md). Parses the two raw CSVs with
proper quote/newline handling (a naive line-split breaks on embedded
newlines in a few cells) and writes clean, normalized JSON that the
TypeScript import scripts consume. Not part of the app; run once by hand.
"""
import csv
import json
import re
from datetime import datetime

BASE = r"C:\Users\Shikho\Documents\Claude files\Leave application automation"
OUT_DIR = BASE + r"\leave-portal\scripts"

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

def parse_d_mon_yy(s: str) -> str | None:
    """'22-May-22' -> '2022-05-22'. Returns None if unparseable."""
    s = s.strip()
    m = re.match(r"^(\d{1,2})-([A-Za-z]{3})-(\d{2})$", s)
    if not m:
        return None
    day, mon, yy = m.groups()
    month = MONTHS.get(mon.lower())
    if not month:
        return None
    year = 2000 + int(yy)
    return f"{year:04d}-{month:02d}-{int(day):02d}"

def parse_timestamp_date(s: str) -> str | None:
    """'21/05/2022 23:45:36' -> '2022-05-21'."""
    s = s.strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if not m:
        return None
    dd, mm, yyyy = m.groups()
    return f"{int(yyyy):04d}-{int(mm):02d}-{int(dd):02d}"

LEAVE_TYPE_MAP = {
    "annual leave": "annual",
    "marriage leave": "marriage",
    "paternity leave": "paternity",
}

# ---- Part B: historical leave applications ----
path = BASE + r"\Leave Application Form (Responses) - for claude.csv"
with open(path, encoding="utf-8-sig", newline="") as f:
    reader = csv.reader(f)
    header = next(reader)
    rows = list(reader)

EMAIL, TYPE, REASON, START, END, TOTAL_DAYS, TIMESTAMP, DAYS = 1, 8, 9, 12, 13, 14, 0, 21

clean = []
skipped = []
for i, r in enumerate(rows):
    email = r[EMAIL].strip().lower()
    leave_type_raw = r[TYPE].strip().lower()
    leave_type = LEAVE_TYPE_MAP.get(leave_type_raw)
    start = parse_d_mon_yy(r[START])
    end = parse_d_mon_yy(r[END])
    applied_on = parse_timestamp_date(r[TIMESTAMP]) or start

    if not email or not leave_type or not start or not end:
        skipped.append({"rowIndex": i, "reason": "unparseable core field", "email": email, "type": r[TYPE], "start": r[START], "end": r[END]})
        continue

    # Days: trust "Total Leave Days" if it parses as a positive number,
    # else flag for the TS side to recompute via calculateLeaveDays.
    days = None
    try:
        v = float(r[TOTAL_DAYS].strip())
        if v > 0:
            days = v
    except ValueError:
        pass

    clean.append({
        "sourceRow": i,
        "email": email,
        "leaveType": leave_type,
        "startDate": start,
        "endDate": end,
        "appliedOn": applied_on,
        "days": days,  # null means: TS side must compute from date range
        "reason": r[REASON].strip(),
    })

with open(OUT_DIR + r"\historical-leaves-clean.json", "w", encoding="utf-8") as f:
    json.dump(clean, f, indent=2)
with open(OUT_DIR + r"\historical-leaves-parse-skipped.json", "w", encoding="utf-8") as f:
    json.dump(skipped, f, indent=2)

print(f"Historical leaves: {len(clean)} parsed cleanly, {len(skipped)} skipped at parse stage (unparseable email/type/dates)")
print(f"  of the {len(clean)} parsed, {sum(1 for c in clean if c['days'] is None)} need days recomputed from dates (Total Leave Days was invalid)")

# ---- Part A: balance snapshot ----
path2 = BASE + r"\Shikho Employee Leave Record - for claude.csv"
with open(path2, encoding="utf-8-sig", newline="") as f:
    reader2 = csv.DictReader(f)
    rows2 = list(reader2)

PLACEHOLDER = {"", "n/a", "0", "-"}
clean2 = []
skipped2 = []
for i, r in enumerate(rows2):
    email = r["email"].strip().lower()
    if email in PLACEHOLDER or "\n" in email or email.count("@") != 1:
        skipped2.append({"rowIndex": i, "reason": "blank/placeholder/corrupted email", "email": r["email"]})
        continue

    def num(col):
        v = r[col].strip()
        return float(v) if v else None

    clean2.append({
        "sourceRow": i,
        "email": email,
        "casualTaken": num("CL Taken"),
        "casualEntitled": num("CL Entitlement"),
        "casualBalance": num("CL Balance"),
        "sickTaken": num("SL Taken"),
        "sickEntitled": num("SL Entitlement"),
        "sickBalance": num("SL Balance"),
        "annualTaken": num("AL Taken"),
        "annualEntitled": num("AL Entitlement"),
        "annualBalance": num("AL Balance"),
    })

with open(OUT_DIR + r"\balance-snapshots-clean.json", "w", encoding="utf-8") as f:
    json.dump(clean2, f, indent=2)
with open(OUT_DIR + r"\balance-snapshots-parse-skipped.json", "w", encoding="utf-8") as f:
    json.dump(skipped2, f, indent=2)

print(f"\nBalance snapshots: {len(clean2)} parsed cleanly, {len(skipped2)} skipped at parse stage")
