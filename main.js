const BUFFER_TIME_CALENDAR = "Buffer time";
const EVENT_DESCRIPTION_ID_PREFIX = "Tied to event: ";
const PREFERRED_TRANSPORT = Maps.DirectionFinder.Mode.DRIVING;
const TRANSPORTS = ["driving", "walking", "bicycling", "transit"];
const EMOJI = { driving: "🚗", walking: "🚶", bicycling: "🚴", transit: "🚆" };
const FOUR_HOURS_SECONDS = 4 * 60 * 60;
const FIVE_HOURS_SECONDS = 5 * 60 * 60;
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
// Home address, the address where the user spends their nights.
const BASE_LOCATION = "Radmanovačka ul. 6f, 10000, Zagreb";
const divmod = (x, y) => [Math.floor(x / y), x % y];

function main() {
  var buffer_time_calendars = CalendarApp
    .getOwnedCalendarsByName(BUFFER_TIME_CALENDAR);
  if (buffer_time_calendars.length === 0) {
    var buffer_time_calendar = CalendarApp.createCalendar(BUFFER_TIME_CALENDAR);
  } else {
    // assume user has only one buffer time calendar
    var buffer_time_calendar = buffer_time_calendars[0];
  }
  var primary_calendar = CalendarApp.getDefaultCalendar();

  // assume all calendars have the same timezone as the default calendar
  const time_zone = primary_calendar.getTimeZone();
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  // google script doesn't provide a method to get first day of the week
  const week_day = Utilities.formatDate(today, time_zone, "u");
  const yesterday = new Date(today.getTime() - 864e5);
  const next_sunday = new Date(today.getTime() + 864e5 * (15 - week_day));
  // console.log("Log: today: " + today);
  // console.log("Log: yesterday: " + yesterday);
  // console.log("Log: next_sunday: " + next_sunday);

  const calendars = CalendarApp.getAllOwnedCalendars();
  var all_events = [];
  for (let calendar of calendars) {
    if (calendar.getId() !== buffer_time_calendar.getId()) {
      all_events = all_events.concat(calendar.getEvents(yesterday, next_sunday));
    }
  }

  all_events.sort(function (event_1, event_2) {
    let event_1_start_date = event_1.getStartTime();
    let event_2_start_date = event_2.getStartTime();
    if ( event_1_start_date < event_2_start_date ) {
      return -1;
    } else if ( event_1_start_date > event_2_start_date ){
      return 1;
    } else {
      return 0;
    }
  });

  var user_cache = CacheService.getUserCache();

  // let current_date = yesterday;
  // let full_day_event_location = undefined;
  let last_location = undefined;
  let last_location_date = undefined;
  let event_location = undefined;
  let event_start_date = undefined;

  for(const event of all_events) {
    if (!!event_location) {
      last_location = event_location;
      last_location_date = event_start_date;
    }
    event_start_date = event.getStartTime();
    // if (event_start_date.getDate() > current_date) {
      // current_date = event_start_date;
      // full_day_event_location = undefined;
    // }

    event_location = event.getLocation();
    if (event.isAllDayEvent()) {
      // if (!!event_location) {
      //   full_day_event_location = event_location;
      // }
      continue;
    }

    if (!!last_location) {
      if (event_start_date - last_location_date >= FOUR_HOURS_SECONDS * 1000) {
        last_location = undefined;
        last_location_date = undefined;
      }
    }
    if (!last_location) {
      // last_location = full_day_event_location ?? BASE_LOCATION;
      last_location = BASE_LOCATION;
    }

    // if (!last_location) {
    //   continue;
    // }

    let event_id = event.getId();
    let event_cached = user_cache.get(event_id);
    if (!!event_cached) {
      console.log(`Log: Event is cached: ${event_cached}`)
      let [
        origin,
        destination,
        start_date,
        buffer_time_event_id
       ] = JSON.parse(event_cached);

      if (
        origin !== last_location
        || destination !== event.getLocation()
        || start_date !== event_start_date
      ) {
        if (!!buffer_time_event_id) {
          buffer_time_event = buffer_time_calendar.getEventById(
            buffer_time_event_id
          );
          buffer_time_event.deleteEvent();
          user_cache.remove(event.getId());
        }
      } else {
        continue;
      }
    } // if event cached

    if (!event_location || event_location === last_location) {
      continue;
    }

    if (![
      CalendarApp.GuestStatus.OWNER,
      CalendarApp.GuestStatus.MAYBE,
      CalendarApp.GuestStatus.YES,
    ].includes(event.getMyStatus())) {
      continue;
    }

    const description_list = [
      "Commute time",
      "From: ${last_location}",
      "To: ${event_location}",
    ];

    // console.log("Log: Last location: " + last_location);
    // console.log("Log: event_location: " + event_location);

    let transport_mode = PREFERRED_TRANSPORT;
    var duration_seconds = Maps.newDirectionFinder()
      .setOrigin(last_location)
      .setDestination(event_location)
      .setArrive(event_start_date)
      .setMode(transport_mode)
      .getDirections()
      .routes[0]?.legs[0]?.duration?.value;

    if (!duration_seconds) {
      continue;
    }

    if (duration_seconds > FIVE_HOURS_SECONDS) {
      user_cache.put(
        event_id,
        JSON.stringify([
          last_location,
          event_location,
          event_start_date,
          undefined,
        ]),
        THIRTY_DAYS_SECONDS
      )
      continue;
    }

    var [minutes, _] = divmod(duration_seconds, 60);
    var [hours, minutes] = divmod(minutes, 60);

    let title = `${EMOJI[transport_mode]} ${transport_mode} `;
    if (hours) {
      title += `${hours} hours`;
    }
    if (minutes) {
      title += `${minutes} minutes`;
    }

    // for (let transport of TRANSPORTS) {
    //   if (transport === PREFERRED_TRANSPORT) {
    //     description_list.push(`[x] ${title}`)
    //     continue;
    //   }

    //   let [duration, text] = get_duration(origin, destination, arrive, mode);
    //   description_list.push(`[ ] ${text}`)
    // }
    // description_list.push(EVENT_DESCRIPTION_ID_PREFIX + event_id);
    // let buffer_time_event_description = description_list.join("\n");

    let buffer_time_event_title = title;
    let buffer_time_event_duration = duration_seconds;
    let buffer_time_event_start_date = new Date(event_start_date.getTime() - buffer_time_event_duration * 1000);
    let buffer_time_event_end_date = event_start_date;
    // console.log(`Log: BT title: ${buffer_time_event_title}`);
    // console.log(`Log: BT start: ${buffer_time_event_start_date}`);
    // console.log(`Log: BT end__: ${buffer_time_event_end_date}`);
    buffer_time_event = buffer_time_calendar.createEvent(
      buffer_time_event_title,
      buffer_time_event_start_date,
      buffer_time_event_end_date,
      // {
      //   description: buffer_time_event_description
      // }
    )
    buffer_time_event_id = buffer_time_event.getId()
    user_cache.put(
      event_id,
      JSON.stringify([
        last_location,
        event_location,
        event_start_date,
        buffer_time_event_id,
      ]),
      THIRTY_DAYS_SECONDS
    )
  }
}
