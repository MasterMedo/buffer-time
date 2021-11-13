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
ID_PREFIX = "Tied to event: "
PREFERRED_TRANSPORT = "driving"
TRANSPORTS = ["driving", "walking", "bicycling", "transit"]
EMOJI = {"driving": "🚗", "walking": "🚶", "bicycling": "🚴", "transit": "🚆"}
CALENDAR_WATCH_LIST = ["Events and activities", "Family"]
TIME_DELTA = 4  # TODO 4 hours

HOME_ADDRESS = "Radmanovačka ul. 6f, 10000, Zagreb"


def get_location_from(prev_event_with_location, start_time):
    if start_time - prev_event_with_location["end"]["dateTime"] > TIME_DELTA:
        return HOME_ADDRESS

    return prev_event_with_location["location"]


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

    calendars = list_calendars(service)
    if BUFFER_TIME_CALENDAR not in calendars:
        calendars[BUFFER_TIME_CALENDAR] = create_buffer_time_calendar(service)

    # TODO: `now` has to be a day before for buffer time events because the
    # current event might have already started but the buffer time event for it
    # has already passed
    now = datetime.datetime.utcnow()
    timeMin = now.isoformat() + "Z"
    timeMax = (
        now + datetime.timedelta(days=13 - now.weekday())
    ).isoformat() + "Z"

    buffer_time_calendar_id = calendars[BUFFER_TIME_CALENDAR]
    buffer_time_calendar_events_result = (
        service.events()
        .list(
            calendarId=buffer_time_calendar_id,
            timeMin=timeMin,
            timeMax=timeMax,
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )
    buffer_time_events = buffer_time_calendar_events_result.get("items", [])

    event_to_buffer_time_event = dict()
    for event in buffer_time_events:
        for line in event["description"].split("\n"):
            if line.startswith(ID_PREFIX):
                event_to_buffer_time_event[line.split(": ")[1]] = event

    with open("key.txt") as f:
        google_maps_key = f.read()

    google_maps_client = googlemaps.Client(google_maps_key)

    # TODO don't iterate over calendars because we need the information of the
    # previous event of the current one (which can be in a different calendar).
    # Instead load all calendars at once and use pointers to get the events in time order.
    for calendar_name in calendars:
        if calendar_name not in CALENDAR_WATCH_LIST:
            continue

        events_result = (
            service.events()
            .list(
                calendarId=calendars[calendar_name],
                timeMin=timeMin - TIME_DELTA,
                timeMax=timeMax,
                maxResults=50,
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )
        events = events_result.get("items", [])

        if not events:
            print("No upcoming events found.")
            continue

        event_i = 0
        last_event_with_location = None
        while event_i < len(events):
            if not events[event_i]["start"].get("dateTime"):
                event_i += 1
                continue
            if events[event_i]["start"]["dateTime"] >= now:
                break
            if events[event_i].get("location"):
                last_event_with_location = events[event_i]
            event_i += 1

        for event in events[event_i:]:

            if event["id"] in event_to_buffer_time_event:
                continue

            # ATTENTION: by ignoring event["start"].get("date"), we
            # intentionally skip full day events like birthdays
            start_time = event["start"].get("dateTime")
            if start_time is None:
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
            location_from = get_location_from(last_event_with_location, event["start"]["startTime"])
            location_to = event.get("location")
            if location_to is None:
                # print("event has no location")
                continue
            last_event_with_location = event
            if location_to == location_from:
                continue

            description_list = []
            # description.append(
            #     f"Commute time\nfrom {old_location}\nto {new_location}."
            # )

            for transport in TRANSPORTS:
                # catch all exceptions here so another transport
                # method can be tried
                distance_matrix = google_maps_client.distance_matrix(
                    origins=[location_from],
                    destinations=[location_to],
                    mode=transport,
                    arrival_time=start_time,
                )
                duration = distance_matrix["rows"][0]["elements"][0].get(
                    "duration"
                )
                if duration is None:
                    continue

                duration_value = duration["value"]
                minutes, seconds = divmod(duration["value"], 60)
                hours, minutes = divmod(minutes, 60)
                if hours > 6:
                    # this event is going to keep recomputing distance matrix
                    continue

                title = f"{EMOJI[transport]} {transport} "
                if hours:
                    title = f"{hours} hours"
                if minutes:
                    title += f"{minutes} minutes"

                description_list.append(title)

                if transport == PREFERRED_TRANSPORT:
                    final_summary = description_list[-1]
                    final_duration_value = duration_value
                    description_list[-1] = "[x] " + description_list[-1]
                else:
                    description_list[-1] = "[ ] " + description_list[-1]

            event_id = event["id"]
            description_list.append(ID_PREFIX + event_id)
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
