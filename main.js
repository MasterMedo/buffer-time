const BUFFER_TIME_CALENDAR = "Buffer time";
const EVENT_DESCRIPTION_ID_PREFIX = "Tied to event: ";
const PREFERRED_TRANSPORT = "driving";
const TRANSPORTS = ["driving", "walking", "bicycling", "transit"];
const EMOJI = { driving: "🚗", walking: "🚶", bicycling: "🚴", transit: "🚆" };
// Calendars that are buffer time events are created for.
const CALENDAR_WATCH_LIST = [
  "Events and activities",
  "Family",
  "mislav.vuletic@memgraph.io",
];
// Amount of time since last having a location to be considered the user
// went to the BASE_LOCATION instead of being at the last event location
const TIME_DELTA = 4 * 60 * 60 * 1000; // 4 hours represented in miliseconds
// Home address, the address where the user spends their nights.
const BASE_LOCATION = "Radmanovačka ul. 6f, 10000, Zagreb";
const MAX_BUFFER_TIME_EVENT_DURATION = 6; // 6 hours
const FIRST_DAY_OF_WEEK = "mon";
const DAY_OF_WEEK_OFFSET = {
  mon: 6,
  tue: 5,
  wed: 4,
  thu: 3,
  fri: 2,
  sat: 1,
  sun: 0,
};

function _day_num(date) {
  return (date.getDay() + DAY_OF_WEEK_OFFSET[FIRST_DAY_OF_WEEK]) % 7;
}

function main() {
  const service = authenticate_and_get_service();
  const calendars = get_user_calendars(service);
  if (!calendars.includes(BUFFER_TIME_CALENDAR)) {
    calendars[BUFFER_TIME_CALENDAR] = create_buffer_time_calendar(service);
  }

  const now = new Date();
  let time_min = new Date(now);
  time_min.setDate(time_min.getDate() - 1); // TODO: time min set to one day earlier, test to see if this breaks something
  time_min = time_min.toISOString();
  let time_max = new Date(now);
  time_max.setDate(time_max.getDate() + 13 - _day_num(now)); // TODO: set hours mins and seconds to 0 and day to next day? (we want the whole day)
  time_max = time_max.toISOString();

  let buffer_time_events = get_calendar_events({
    // TODO: check how js function call works, object as input or?
    service: service,
    calendar_id: calendars[BUFFER_TIME_CALENDAR].id,
    time_min: time_min,
    time_max: time_max,
  });

  let event_to_buffer_time_event = {};
  for (const event of buffer_time_events) {
    for (const line of event.description.split("\n")) {
      if (line.startsWith(EVENT_DESCRIPTION_ID_PREFIX)) {
        event_to_buffer_time_event[line.split(": ")[1]] = event;
      }
    }
  }

  // js TODO write in js
  const google_maps_client = googlemaps.Client(google_maps_key);

  // TODO don't iterate over calendars because we need the information of the
  // previous event of the current one (which can be in a different calendar).
  // Instead load all calendars at once and use pointers to get the events in
  // time order.
  for (const calendar_name of calendars) {
    if (!CALENDAR_WATCH_LIST.includes(calendar_name)) {
      continue;
    }

    let events = get_calendar_events({
      service: service,
      calendar_id: calendars[calendar_name].id,
      time_min: time_min,
      time_max: time_max,
    });

    if (!events.length) {
      // console.log("No upcoming events found.");
      continue;
    }

    events = iter(events); // js TODO js doesn't have iter
    let last_location;
    let last_location_time;
    let full_day_event_location; // TODO: add full_day_event_date and later check if current event has the same date as full day event and use this time only then
    let work_location; // TODO: get from working hours
    for (const event of events) {
      if (!event.start?.dateTime) {
        full_day_event_location = event?.location;
        continue;
      }

      let event_end_time = new Date(event.end.dateTime);
      if (event_end_time >= now) {
        break;
      } else if (!!event?.location) {
        last_location = event.location;
        last_location_time = event_end_time;
      }
    }

    events = chain([event], events); // js TODO js doesn't have chain

    for (const event of events) {
      if (event_to_buffer_time_event.includes(event.id)) {
        // TODO: Check if location or time of main event was updated.
        // Update the Buffer time event accordingly.
        continue;
      }

      let start_time = event.start?.dateTime;
      // TODO: if new date has started check for work_location
      if (!start_time) {
        if (!!event?.location) {
          full_day_event_location = event.location;
        }
        continue;
      }

      if (!event?.organizer?.self) {
        let status;
        for (const a of event?.attendees) {
          if (!!a?.self) {
            status = a.responseStatus;
            break;
          }
        }
        // needsAction, tentative, accepted
        if (!["accepted", "tentative"].includes(status)) {
          continue;
        }
      }

      start_time = new Date(start_time);

      const event_location = event?.location;
      if (!!event_location) {
        continue;
      }

      const last_location =
        start_time - last_location_time < TIME_DELTA
          ? last_location
          : full_day_event_location || work_location || BASE_LOCATION;

      if (event_location === last_location) {
        continue;
      }

      const description_list = [
        "Commute time",
        "From: ${last_location}",
        "To: ${event_location}",
      ];

      let final_summary;
      let final_duration;
      for (const transport of TRANSPORTS) {
        const duration = get_duration({
          google_maps_client: google_maps_client,
          origin: last_location,
          destination: event_location,
          mode: transport,
          arrival_time: start_time.getTime() / 1000, // getTime returns miliseconds, get_duration expects seconds
        });

        if (!duration) {
          continue;
        }

        const divmod = (x, y) => [Math.floor(x / y), x % y];
        const [minutes, seconds] = divmod(duration, 60);
        const [hours, minutes] = divmod(minutes, 60);
        if (hours > MAX_BUFFER_TIME_EVENT_DURATION) {
          // this event is going to keep recomputing distance matrix
          continue;
        }

        let title = "${EMOJI[transport]} ${transport} ";
        if (hours) {
          title += "${hours} hours";
        }
        if (minutes) {
          title += "${minutes} minutes";
        }

        description_list.push(title);

        if (transport === PREFERRED_TRANSPORT) {
          final_summary = description_list[-1];
          final_duration = duration;
          description_list[-1] = "[x] " + description_list[-1];
        } else {
          description_list[-1] = "[ ] " + description_list[-1];
        }
      }

      if (!final_summary) {
        continue;
      }

      const event_id = event.id;
      description_list.push(EVENT_DESCRIPTION_ID_PREFIX + event_id);
      description = description_list.join("\n");
      create_calendar_event({
        service: service,
        buffer_time_calendar_id: calendars[BUFFER_TIME_CALENDAR].id,
        summary: final_summary,
        description: description,
        start_time: new Date(start_time.getTime() - final_duration * 1000),
        end_time: start_time,
        recurrence: "",
        timezone: event.start.timeZone,
      });

      last_location = event_location;
    }
  }
}

function get_duration({
  google_maps_client,
  origin,
  destination,
  mode,
  arrival_time,
} = {}) {
  // catch all exceptions here so another transport
  // method can be tried
  const distance_matrix = google_maps_client.distance_matrix({
    origins: [origin],
    destinations: [destination],
    mode: mode,
    arrival_time: arrival_time,
  });
  const duration = distance_matrix.rows[0].elements[0]?.duration;
  return duration?.value;
}

// js TODO entire function
function authenticate_and_get_service() {
  let creds;
  if (os.path.exists("token.json")) {
    creds = Credentials.from_authorized_user_file("token.json", SCOPES);
  }

  if (!creds || !creds.valid) {
    if (creds && creds.expired && creds.refresh_token) {
      creds.refresh(Request());
    } else {
      flow = InstalledAppFlow.from_client_secrets_file(
        "credentials.json",
        SCOPES
      );
      creds = flow.run_local_server({ port: 0 });
    }

    // with open("token.json", "w") as token {
    //     token.write(creds.to_json());
    // }
  }

  service = build("calendar", "v3", (credentials = creds));
  return service;
}

function get_calendar_events(service, calendar_id, time_min, time_max) {
  const calendar_events_result = service
    .events()
    .list({
      calendarId: calendar_id,
      timeMin: time_min,
      timeMax: time_max,
      maxResults: 5,
      singleEvents: True,
      orderBy: "startTime",
    })
    .execute();
  const events = calendar_events_result?.items;
  return events || [];
}

function get_user_calendars(service) {
  /*
    Returns a dictionary of all calendars the user has access to.
    The key in the dictionary represents the summary of the calendar.
    The value in the dictionary represents the calendar object.
    */
  let calendars = {};
  let page_token;
  while (true) {
    const calendar_list = service
      .calendarList()
      .list({ pageToken: page_token })
      .execute();
    for (const calendar of calendar_list.items) {
      // for choosing which calendar should be on the watch list you have
      // to use `summaryOverride` (user edited original summary)
      // for looking up BUFFER_TIME_CALENDAR in calendars you have to use
      // `summary` because user might've changed the summary
      // name = calendar?.summaryOverride || calendar?.summary
      const name = calendar?.summary;
      if (name) {
        calendars = { ...calendars, [name]: calendar };
      }
    }

    page_token = calendar_list?.nextPageToken;
    if (!page_token) {
      break;
    }
  }

  return calendars;
}

function create_buffer_time_calendar(service) {
  const calendar = {
    summary: BUFFER_TIME_CALENDAR,
  };
  // TODO if this fails the user should be notified and app should exit
  const created_calendar = service
    .calendars()
    .insert({ body: calendar })
    .execute();
  return created_calendar;
}

function create_calendar_event({
  service,
  buffer_time_calendar_id,
  summary,
  description,
  start_time,
  end_time,
  timezone,
  recurrence,
} = {}) {
  const start = {
    dateTime: start_time.toISOString(),
    timeZone: timezone,
  };
  const end = {
    dateTime: end_time.toISOString(),
    timeZone: timezone,
  };
  const buffer_time_event = {
    summary: summary,
    // "location: "",
    description: description,
    start: start,
    end: end,
    // recurrence: recurrence,
  };
  const buffer_time_event = service
    .events()
    .insert({ calendarId: buffer_time_calendar_id, body: buffer_time_event })
    .execute();

  console.log("Event created{ %s" % buffer_time_event.get("htmlLink"));
}
