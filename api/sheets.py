import os
from google.oauth2 import service_account
from googleapiclient.discovery import build

SPREADSHEET_ID = os.environ.get("SPREADSHEET_ID", "1gyo42oQf6Ll97vfP8e-kcBdX7rhRMoaOKLQNUh02TpA")
SHEET_NAME = "Sheet1"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
CREDENTIALS_FILE = os.path.join(os.path.dirname(__file__), "credentials.json")

HEADERS = ["Title", "Company", "Location", "Link", "Date Saved", "Status"]


def _service():
    creds = service_account.Credentials.from_service_account_file(
        CREDENTIALS_FILE, scopes=SCOPES
    )
    return build("sheets", "v4", credentials=creds)


def ensure_header_row():
    """Write the header row if A1 is empty."""
    svc = _service()
    result = svc.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{SHEET_NAME}!A1",
    ).execute()

    if not result.get("values"):
        svc.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{SHEET_NAME}!A1",
            valueInputOption="RAW",
            body={"values": [HEADERS]},
        ).execute()


def append_job(job) -> None:
    row = [
        job.title,
        job.company,
        job.location or "",
        job.link,
        job.date_saved or "",
        job.status,
    ]
    _service().spreadsheets().values().append(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{SHEET_NAME}!A1",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": [row]},
    ).execute()
