"""
Data-cleaning pass for the historical leave import. Parses the two raw CSVs
with proper quote/newline handling (a naive line-split breaks on embedded
newlines in a few cells) and writes clean, normalized JSON that the
TypeScript import scripts consume. Not part of the app; run by hand.

Second edition (2026-09-14): sources are the full "Final" / "Form responses
1" exports in Downloads, and each form row is resolved to a person via its
"Clean ID" (column S) first — the same person appears under several emails
(.tech vs .com, personal Gmail before an @shikho.com address) — using the
leave-record file's ID -> email mapping, then the form's own "Email address"
(column B) as the fallback. The balance-snapshot file is taken as-is.
"""
import csv
import json
import re

FORM = r"C:\Users\Shikho\Downloads\Leave Application Form (Responses) - Form responses 1.csv"
RECORD = r"C:\Users\Shikho\Downloads\Shikho Employee Leave Record - Final.csv"
OUT_DIR = r"C:\Users\Shikho\Documents\Claude files\Leave application automation\leave-portal\scripts"

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

def parse_d_mon_yy(s: str) -> str | None:
    """'22-May-22' or '22-May-2022' -> '2022-05-22'. Returns None if unparseable."""
    s = s.strip()
    m = re.match(r"^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$", s)
    if not m:
        return None
    day, mon, yy = m.groups()
    month = MONTHS.get(mon.lower())
    if not month:
        return None
    year = int(yy) if len(yy) == 4 else 2000 + int(yy)
    return f"{year:04d}-{month:02d}-{int(day):02d}"

def parse_timestamp_date(s: str) -> str | None:
    """'21/05/2022 23:45:36' -> '2022-05-21'."""
    s = s.strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if not m:
        return None
    dd, mm, yyyy = m.groups()
    return f"{int(yyyy):04d}-{int(mm):02d}-{int(dd):02d}"

def norm_id(s: str) -> str:
    """'0029' and '29' are the same person; non-numeric IDs are kept verbatim."""
    s = s.strip()
    return str(int(s)) if s.isdigit() else s.lower()

LEAVE_TYPE_MAP = {
    "annual leave": "annual",
    "marriage leave": "marriage",
    "paternity leave": "paternity",
}

PLACEHOLDER = {"", "n/a", "0", "-"}

def clean_email(v: str) -> str | None:
    e = v.strip().lower()
    if e in PLACEHOLDER or "\n" in e or e.count("@") != 1:
        return None
    return e

# ---- Part A: balance snapshot (also gives the ID -> current email map) ----
with open(RECORD, encoding="utf-8-sig", newline="") as f:
    rows2 = [r for r in csv.DictReader(f) if (r.get("ID") or "").strip() or (r.get("email") or "").strip()]

email_by_id: dict[str, str] = {}
clean2 = []
skipped2 = []
for i, r in enumerate(rows2):
    email = clean_email(r["email"])
    if not email:
        skipped2.append({"sourceRow": i, "reason": "blank/placeholder/corrupted email", "id": r["ID"], "email": r["email"]})
        continue
    rid = norm_id(r["ID"])
    if rid and rid not in email_by_id:
        email_by_id[rid] = email

    def num(col):
        v = (r.get(col) or "").strip()
        try:
            return float(v) if v else None
        except ValueError:
            return None

    clean2.append({
        "sourceRow": i,
        "id": r["ID"].strip(),
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

print(f"Balance snapshots: {len(clean2)} parsed cleanly, {len(skipped2)} skipped at parse stage; {len(email_by_id)} ID->email mappings")

# ---- Part B: historical leave applications ----
with open(FORM, encoding="utf-8-sig", newline="") as f:
    reader = csv.reader(f)
    header = next(reader)
    rows = list(reader)

TIMESTAMP, EMAIL, TYPE, REASON, START, END, TOTAL_DAYS, CLEAN_ID = 0, 1, 8, 9, 12, 13, 14, 18

clean = []
skipped = []
matched_by = {"cleanId": 0, "email": 0}
for i, r in enumerate(rows):
    form_email = clean_email(r[EMAIL])
    clean_id = norm_id(r[CLEAN_ID])
    email = email_by_id.get(clean_id)
    if email:
        matched_by["cleanId"] += 1
    else:
        email = form_email
        if email:
            matched_by["email"] += 1
    leave_type = LEAVE_TYPE_MAP.get(r[TYPE].strip().lower())
    start = parse_d_mon_yy(r[START])
    end = parse_d_mon_yy(r[END])
    applied_on = parse_timestamp_date(r[TIMESTAMP]) or start

    if not email or not leave_type or not start or not end:
        skipped.append({"rowIndex": i, "reason": "unparseable core field", "cleanId": r[CLEAN_ID], "email": r[EMAIL], "type": r[TYPE], "start": r[START], "end": r[END]})
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
        "cleanId": r[CLEAN_ID].strip(),
        "formEmail": form_email,
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
print(f"  resolved via Clean ID: {matched_by['cleanId']}, via form email only: {matched_by['email']}")
print(f"  of the {len(clean)} parsed, {sum(1 for c in clean if c['days'] is None)} need days recomputed from dates (Total Leave Days was invalid)")
print(f"  rows where Clean ID mapped to a different email than the form's: {sum(1 for c in clean if c['formEmail'] and c['formEmail'] != c['email'])}")
