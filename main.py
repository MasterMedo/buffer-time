import datetime
import os.path
import googlemaps

from googleapiclient.discovery import build
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

# If modifying these scopes, delete the file token.json.
SCOPES = ["https://www.googleapis.com/auth/calendar"]
BUFFER_TIME_CALENDAR = "Buffer time"


def main():
    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
            creds = flow.run_local_server(port=0)

        with open("token.json", "w") as token:
            token.write(creds.to_json())

    service = build("calendar", "v3", credentials=creds)
    calendars = list_calendars(service)
    if BUFFER_TIME_CALENDAR not in calendars:
        calendars[BUFFER_TIME_CALENDAR] = create_buffer_time_calendar(service)

    # Call the Calendar API
    now = datetime.datetime.utcnow().isoformat() + "Z"  # 'Z' indicates UTC time
    print("Getting the upcoming 10 events")
    events_result = (
        service.events()
        .list(
            calendarId="primary",
            timeMin=now,
            maxResults=10,
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )
    events = events_result.get("items", [])

    if not events:
        print("No upcoming events found.")

    with open("key.txt") as f:
        google_maps_key = f.read()

    google_maps_client = googlemaps.Client(google_maps_key)
    origins = ["Radmanovačka ul. 6f, 10000, Zagreb"]
    for event in events:
        start_time = event["start"].get("dateTime", event["start"].get("date"))
        # convert start time to integer
        if not start_time:
            print("event has no start time")
            continue

        location = event.get("location")
        if not location:
            print("event has no location")
            continue

        distance_matrix = google_maps_client.distance_matrix(
            origins=origins,
            destinations=[location],
            mode="driving",
            arrival_time=start_time,
        )

        duration = distance_matrix["rows"][0]["elements"][0]["duration"]
        print(duration["text"])


def list_calendars(service):
    calendars = {}
    page_token = None
    while True:
        calendar_list = service.calendarList().list(pageToken=page_token).execute()
        for calendar in calendar_list["items"]:
            name = calendar.get("summaryOverride", calendar.get("summary"))
            id_ = calendar.get("id")
            calendars[name] = calendar.get("id")
        page_token = calendar_list.get("nextPageToken")
        if not page_token:
            break

    return calendars


def create_buffer_time_calendar(service):
    calendar = {
        "summary": BUFFER_TIME_CALENDAR,
    }
    created_calendar = service.calendars().insert(body=calendar).execute()
    return created_calendar["id"]


if __name__ == "__main__":
    main()
