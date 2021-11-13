import datetime
import os.path
import googlemaps

from itertools import chain
from googleapiclient.discovery import build
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

# If modifying these scopes, delete the file token.json.
SCOPES = ["https://www.googleapis.com/auth/calendar"]
# Having a dedicated calendar for buffer time events is that other people
# who don't have a view to that particular calendar won't know you have
# buffer time between events and might schedule back to back meetings.
BUFFER_TIME_CALENDAR = "Buffer time"
EVENT_DESCRIPTION_ID_PREFIX = "Tied to event: "
PREFERRED_TRANSPORT = "driving"
TRANSPORTS = ["driving", "walking", "bicycling", "transit"]
EMOJI = {"driving": "🚗", "walking": "🚶", "bicycling": "🚴", "transit": "🚆"}
# Calendars that are buffer time events are created for.
CALENDAR_WATCH_LIST = [
    "Events and activities",
    "Family",
    "mislav.vuletic@memgraph.io",
]
# Amount of time since last having a location to be considered the user
# went to the BASE_LOCATION instead of being at the last event location
TIME_DELTA = 4 * 60 * 60  # 4 hours
# Home address, the address where the user spends their nights.
BASE_LOCATION = "Radmanovačka ul. 6f, 10000, Zagreb"
MAX_BUFFER_TIME_EVENT_DURATION = 6  # 6 hours


def main():
    service = authenticate_and_get_service()
    calendars = get_user_calendars(service)
    if BUFFER_TIME_CALENDAR not in calendars:
        calendars[BUFFER_TIME_CALENDAR] = create_buffer_time_calendar(service)

    # TODO: `now` has to be a day before for buffer time events because the
    # current event might have already started but the buffer time event for it
    # has already passed
    now = datetime.datetime.utcnow()
    time_min = now.isoformat() + "Z"
    time_max = (
        now + datetime.timedelta(days=13 - now.weekday())
    ).isoformat() + "Z"

    buffer_time_events = get_calendar_events(
        service=service,
        calendar_id=calendars[BUFFER_TIME_CALENDAR]["id"],
        time_min=time_min,
        time_max=time_max,
    )

    event_to_buffer_time_event = dict()
    for event in buffer_time_events:
        for line in event["description"].split("\n"):
            if line.startswith(EVENT_DESCRIPTION_ID_PREFIX):
                event_to_buffer_time_event[line.split(": ")[1]] = event

    with open("key.txt") as f:
        google_maps_key = f.read()

    google_maps_client = googlemaps.Client(google_maps_key)

    # TODO don't iterate over calendars because we need the information of the
    # previous event of the current one (which can be in a different calendar).
    # Instead load all calendars at once and use pointers to get the events in
    # time order.
    for calendar_name in calendars:
        if calendar_name not in CALENDAR_WATCH_LIST:
            continue

        events = get_calendar_events(
            service=service,
            calendar_id=calendars[calendar_name]["id"],
            time_min=time_min,
            time_max=time_max,
        )

        if not events:
            print("No upcoming events found.")
            continue

        events = iter(events)
        last_location = None
        last_location_time = 0
        full_day_event_location = None
        work_location = None  # TODO: get from working hours
        for event in events:
            if event["start"].get("dateTime") is None:
                full_day_event_location = event.get("location")
                continue

            seconds = date_time_string_to_seconds(event["end"]["dateTime"])
            if seconds >= now.timestamp():
                break

            elif event.get("location"):
                last_location = event["location"]
                last_location_time = seconds

        events = chain([event], events)

        for event in events:
            if event["id"] in event_to_buffer_time_event:
                # TODO: Check if location or time of main event was updated.
                # Update the Buffer time event accordingly.
                continue

            # ATTENTION: by ignoring event["start"].get("date"), we
            # intentionally skip full day events like birthdays
            # if we have an event that lasts multiple days, but on the last day
            # it has an end time. We take that the user is on that location
            # until the end time. This is important because we ignore vacation
            # events if they don't have and end dateTime for the following
            # reason: the user could have a vacation event that includes
            # friday, but on friday the user leaves the vacation location
            # at 10:00am, then the user goes half-way to home and at 13:00,
            # the user has lunch until 14:00. At 19:00 the user has an event
            # at home, so the app creates a buffer event from the vacation
            # location to the home address, instead of the half-way point
            # because more than 4 hours passed between events.
            start_time = event["start"].get("dateTime")
            # TODO: if new date has started check for work_location
            if start_time is None:
                if location := event.get("location"):
                    full_day_event_location = location
                continue

            if not event.get("organizer", {}).get("self"):
                status = next(
                    (
                        a.get("responseStatus")
                        for a in event.get("attendees", [])
                        if a.get("self")
                    ),
                    None,
                )
                # needsAction, tentative, accepted
                if status not in ["accepted", "tentative"]:
                    continue

            start_time = date_time_string_to_seconds(start_time)

            event_location = event.get("location")
            if event_location is None:
                continue

            # TODO: convert start time to integer
            last_location = (
                last_location
                if start_time - last_location_time < TIME_DELTA
                else full_day_event_location or work_location or BASE_LOCATION
            )

            if event_location == last_location:
                continue

            description_list = [
                f"Commute time",
                f"From: {last_location}",
                f"To: {event_location}",
            ]

            final_summary = None
            final_duration = None
            for transport in TRANSPORTS:
                duration = get_duration(
                    google_maps_client=google_maps_client,
                    origin=last_location,
                    destination=event_location,
                    mode=transport,
                    arrival_time=start_time,
                )

                if duration is None:
                    continue

                minutes, seconds = divmod(duration, 60)
                hours, minutes = divmod(minutes, 60)
                if hours > MAX_BUFFER_TIME_EVENT_DURATION:
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
                    final_duration = duration
                    description_list[-1] = "[x] " + description_list[-1]
                else:
                    description_list[-1] = "[ ] " + description_list[-1]

            if final_summary is None:
                continue

            event_id = event["id"]
            description_list.append(EVENT_DESCRIPTION_ID_PREFIX + event_id)
            description = "\n".join(description_list)
            create_calendar_event(
                service=service,
                buffer_time_calendar_id=calendars[BUFFER_TIME_CALENDAR]["id"],
                summary=final_summary,
                description=description,
                start_time=datetime.datetime.fromtimestamp(
                    start_time - final_duration
                ),
                end_time=datetime.datetime.fromtimestamp(start_time),
                recurrence="",
                timezone=event["start"]["timeZone"],
            )
            last_location = event_location


def date_time_string_to_seconds(date_time):
    date_time = datetime.datetime.fromisoformat(date_time.strip("Z"))
    if (
        date_time.tzinfo is None
        or date_time.tzinfo.utcoffset(date_time) is None
    ):
        seconds = (date_time - datetime.datetime(1970, 1, 1)).total_seconds()
    else:
        seconds = date_time.timestamp()

    return seconds


def get_duration(google_maps_client, origin, destination, mode, arrival_time):
    # catch all exceptions here so another transport
    # method can be tried
    distance_matrix = google_maps_client.distance_matrix(
        origins=[origin],
        destinations=[destination],
        mode=mode,
        arrival_time=arrival_time,
    )
    duration = distance_matrix["rows"][0]["elements"][0].get("duration", {})
    return duration.get("value")


def authenticate_and_get_service():
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
    return service


def get_calendar_events(service, calendar_id, time_min, time_max):
    calendar_events_result = (
        service.events()
        .list(
            calendarId=calendar_id,
            timeMin=time_min,
            timeMax=time_max,
            maxResults=5,
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )
    events = calendar_events_result.get("items", [])
    return events


def get_user_calendars(service):
    """Returns a dictionary of all calendars the user has access to.
    The key in the dictionary represents the summary of the calendar.
    The value in the dictionary represents the calendar object.
    """
    calendars = {}
    page_token = None
    while True:
        calendar_list = (
            service.calendarList().list(pageToken=page_token).execute()
        )
        for calendar in calendar_list["items"]:
            # for choosing which calendar should be on the watch list you have
            # to use `summaryOverride` (user edited original summary)
            # for looking up BUFFER_TIME_CALENDAR in calendars you have to use
            # `summary` because user might've changed the summary
            # name = calendar.get("summaryOverride", calendar.get("summary"))
            name = calendar.get("summary")
            calendars[name] = calendar
        page_token = calendar_list.get("nextPageToken")
        if not page_token:
            break

    return calendars


def create_buffer_time_calendar(service):
    calendar = {
        "summary": BUFFER_TIME_CALENDAR,
    }
    # TODO: if this fails the user should be notified and app should exit
    created_calendar = service.calendars().insert(body=calendar).execute()
    return created_calendar


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
