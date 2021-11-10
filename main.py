import datetime
import os.path
import googlemaps
import pytz

from googleapiclient.discovery import build
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

# If modifying these scopes, delete the file token.json.
SCOPES = ["https://www.googleapis.com/auth/calendar"]
BUFFER_TIME_CALENDAR = "Buffer time"
PREFERRED_TRANSPORT = "driving"
TRANSPORTS = ["driving", "walking", "bicycling", "transit"]
EMOJI = {"driving": "🚗", "walking": "🚶", "bicycling": "🚴", "transit": "🚆"}
CALENDAR_WATCH_LIST = ["Events and activities", "Family"]


def main():
    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                "credentials.json", SCOPES
            )
            creds = flow.run_local_server(port=0)

        with open("token.json", "w") as token:
            token.write(creds.to_json())

    service = build("calendar", "v3", credentials=creds)

    # get all calendars and create calendar BUFFER_TIME_CALENDAR
    calendars = list_calendars(service)
    if BUFFER_TIME_CALENDAR not in calendars:
        calendars[BUFFER_TIME_CALENDAR] = create_buffer_time_calendar(service)

    with open("key.txt") as f:
        google_maps_key = f.read()

    google_maps_client = googlemaps.Client(google_maps_key)

    for calendar_name in calendars:
        if calendar_name not in CALENDAR_WATCH_LIST:
            continue

        start = datetime.datetime.utcnow()
        events_result = (
            service.events()
            .list(
                calendarId=calendars[calendar_name],
                timeMin=start.isoformat() + "Z",
                timeMax=(
                    start + datetime.timedelta(days=13 - start.weekday())
                ).isoformat()
                + "Z",
                maxResults=5,
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )
        events = events_result.get("items", [])

        if not events:
            print("No upcoming events found.")
            continue
        # get last location
        origins = ["Radmanovačka ul. 6f, 10000, Zagreb"]
        for event in events:
            start_time = event["start"].get("dateTime")
            tz = pytz.timezone(event["start"].get("timeZone"))
            if start_time is None or tz is None:
                print("event has no start time")
                continue

            start_time = datetime.datetime.fromisoformat(start_time.strip("Z"))
            if start_time.tzinfo is None or start_time.tzinfo.utcoffset(start_time) is None:
                start_time = (
                    start_time - datetime.datetime(1970, 1, 1)
                ).total_seconds()
            else:
                start_time = start_time.timestamp()
            # TODO: convert start time to integer
            location = event.get("location")
            if location is None:
                # print("event has no location")
                continue

            description_list = []
            # description.append(
            #     f"Commute time from {old_location} to {new_location}."
            # )

            for transport in TRANSPORTS:
                # catch all exceptions here so another transport
                # method can be tried
                distance_matrix = google_maps_client.distance_matrix(
                    origins=origins,
                    destinations=[location],
                    mode=transport,
                    arrival_time=start_time,
                )
                duration = distance_matrix["rows"][0]["elements"][0].get(
                    "duration"
                )
                if duration is None:
                    continue

                duration_value = duration["value"]
                duration_text = duration["text"]
                description_list.append(
                    EMOJI[transport] + " " + transport + " " + duration_text
                )

                if transport == PREFERRED_TRANSPORT:
                    final_summary = description_list[-1]
                    final_duration_value = duration_value
                    description_list[-1] = "[x] " + description_list[-1]
                else:
                    description_list[-1] = "[ ] " + description_list[-1]

            event_id = event["id"]
            description_list.append(f"Tied to event: {event_id}")
            description = "\n".join(description_list)
            create_calendar_event(
                service=service,
                buffer_time_calendar_id=calendars[BUFFER_TIME_CALENDAR],
                summary=final_summary,
                description=description,
                start_time=datetime.datetime.fromtimestamp(
                    start_time - final_duration_value
                ),
                end_time=datetime.datetime.fromtimestamp(start_time),
                recurrence="",
                timezone=event["start"]["timeZone"],
            )


def list_calendars(service):
    # for choosing which calendar should be on the watch list you have to use summaryOverride
    # for looking up BUFFER_TIME_CALENDAR in calendars you have to use summary
    calendars = {}
    page_token = None
    while True:
        calendar_list = (
            service.calendarList().list(pageToken=page_token).execute()
        )
        for calendar in calendar_list["items"]:
            # name = calendar.get("summaryOverride", calendar.get("summary"))
            name = calendar.get("summary")
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


def create_calendar_event(
    service,
    buffer_time_calendar_id,
    summary,
    description,
    start_time,
    end_time,
    timezone,
    recurrence,
):
    start = {
        "dateTime": start_time.isoformat(),
        "timeZone": timezone,
    }
    end = {
        "dateTime": end_time.isoformat(),
        "timeZone": timezone,
    }
    buffer_time_event = {
        "summary": summary,
        # "location": "",
        "description": description,
        "start": start,
        "end": end,
        # "recurrence": recurrence,
    }
    buffer_time_event = (
        service.events()
        .insert(calendarId=buffer_time_calendar_id, body=buffer_time_event)
        .execute()
    )
    print("Event created: %s" % (buffer_time_event.get("htmlLink")))


if __name__ == "__main__":
    main()
