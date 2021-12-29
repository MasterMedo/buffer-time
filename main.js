const BUFFER_TIME_CALENDAR = "Buffer time";
const EVENT_DESCRIPTION_ID_PREFIX = "Tied to event: ";
const PREFERRED_TRANSPORT = Maps.DirectionFinder.Mode.DRIVING;
const TRANSPORTS = ["driving", "walking", "bicycling", "transit"];
const EMOJI = { driving: "🚗", walking: "🚶", bicycling: "🚴", transit: "🚆" };
const FOUR_HOURS_SECONDS = 4 * 60 * 60;
const FIVE_HOURS_SECONDS = 5 * 60 * 60;
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

// Home address, the address where the user spends their nights.
// Should be set by using some kind of user interface
const BASE_LOCATION = undefined;
const divmod = (x, y) => [Math.floor(x / y), x % y];


function get_duration(origin, destination, arrive_time, transport) {
  let cache = CacheService.getUserCache();
  let key = JSON.stringify([origin, destination, transport]);

  let duration = cache.get(key);
  if (duration !== null) { // if key is not in cache (could be undefined)
    try {
      let n = Number(duration);
      console.log(`Google maps cache kicked in: ${key}: ${n} seconds`);
      return n;
    } catch(err) {
      return undefined; // a path doesn't exist
    }
  }

  let transport_mode = PREFERRED_TRANSPORT;
  var duration_seconds = Maps.newDirectionFinder()
    .setOrigin(origin)
    .setDestination(destination)
    .setArrive(arrive_time)
    .setMode(transport)
    .getDirections()
    .routes[0]?.legs[0]?.duration?.value;

  if (!!duration_seconds) {
    cache.put(key, JSON.stringify(duration_seconds), THIRTY_DAYS_SECONDS);
  } else {
    cache.put(key, "undefined", THIRTY_DAYS_SECONDS);
  }

  return duration_seconds;
}


function main() {
  var buffer_time_calendars = CalendarApp
    .getOwnedCalendarsByName(BUFFER_TIME_CALENDAR);
  if (buffer_time_calendars.length === 0) {
    var buffer_time_calendar = CalendarApp.createCalendar(BUFFER_TIME_CALENDAR);
    console.log("Buffer time calendar created!")
  } else {
    // TODO: assume user has only one buffer time calendar
    var buffer_time_calendar = buffer_time_calendars[0];
  }
  var primary_calendar = CalendarApp.getDefaultCalendar();

  // TODO: assume all calendars have the same timezone as the default calendar
  const time_zone = primary_calendar.getTimeZone();
  const today = new Date(new Date().setHours(0, 0, 0, 0));

  // google script doesn't provide a method to get first day of the week
  const week_day = Utilities.formatDate(today, time_zone, "u");
  const yesterday = new Date(today.getTime() - 864e5);
  const next_sunday = new Date(today.getTime() + 864e5 * (15 - week_day));
  // console.log("Log: today: " + today);
  // console.log("Log: yesterday: " + yesterday);
  // console.log("Log: next_sunday: " + next_sunday);

  // TODO: assumes all user calendars have the same timezone
  const calendars = CalendarApp.getAllOwnedCalendars();
  var all_events = [];
  for (let calendar of calendars) {
    if (calendar.getId() !== buffer_time_calendar.getId()) {
      all_events = all_events.concat(calendar.getEvents(yesterday, next_sunday));
    }
  }

  all_events.sort(function (event_1, event_2) { // sorts events by start_time
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

  // gets user cache, the cache cannot be cleared except key by key
  // this is why we set the cache to 30 days
  var user_cache = CacheService.getUserCache();

  // let current_date = yesterday;
  // let full_day_event_location = undefined;
  let last_location = undefined;
  let last_location_date = undefined;
  let event_location = undefined;
  let event_start_date = undefined;

  for(const event of all_events) {
    // console.log(event.getStartTime())
    if (!!event_location) {  // if old event location exists
      last_location = event_location;
      last_location_date = event.getEndTime();
    }

    event_start_date = event.getStartTime();
    // TODO: handle full day events
    // if (event_start_date.getDate() > current_date) {  // if new day has begun
      // current_date = event_start_date;
      // full_day_event_location = undefined;
    // }

    event_location = event.getLocation();
    if (event.isAllDayEvent()) { // if event is an all day event
      // if (!!event_location) {
      //   full_day_event_location = event_location;
      // }
      continue;
    }

    if (!!last_location) { // if last location exists
      // if more than four hours passed since user was at last location
      if (event_start_date - last_location_date >= FOUR_HOURS_SECONDS * 1000) {
        last_location = undefined;
        last_location_date = undefined;
      }
    }
    if (!last_location) { // if last location doesn't exist
      // last_location = full_day_event_location ?? BASE_LOCATION;
      last_location = BASE_LOCATION;
    }

    if (!last_location) { // if BASE_LOCATION isn't set
      continue;
    }

    // TODO: recurring events don't have unique ids
    // maybe they can be handled by using event tags?
    if (event.isRecurringEvent()) {
      continue;
    }

    let event_id = event.getId();
    let buffer_time_event_cached = user_cache.get(event_id);
    if (!!buffer_time_event_cached) { // if event cached
      // console.log(`Log: Event is cached: ${buffer_time_event_cached}`)
      // -------------------------------------------
      // commented block used for clearing the cache
      // user_cache.remove(buffer_time_event_cached);
      // continue;
      // -------------------------------------------
      let [
        origin,
        destination,
        start_date,
        buffer_time_event_id
       ] = JSON.parse(buffer_time_event_cached);
      if (
        origin !== last_location
        || destination !== event.getLocation()
        || start_date !== event_start_date.toISOString()
      ) { // if origin, destination or start_date changed
        if (!!buffer_time_event_id) {
          // sometimes this returns an event object even if the user deleted it
          buffer_time_event = buffer_time_calendar.getEventById(
            buffer_time_event_id
          );
          try {
            buffer_time_event.deleteEvent();
          } catch(err) {
            // the user deleted the event already
          }
          user_cache.remove(event.getId());
          console.log(`Buffer time event deleted from cache ${event.getId()}`)
        }
      } else { // origin, destination and start_date didn't change
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

    // console.log("Log: Last location: " + last_location);
    // console.log("Log: event_location: " + event_location);

    let transport_mode = PREFERRED_TRANSPORT;
    var duration_seconds = get_duration(
      last_location,
      event_location,
      event_start_date,
      transport_mode,
    );

    if (!duration_seconds) { // if a path doesn't exist from one location to the other
      continue;
    }

    if (duration_seconds > FIVE_HOURS_SECONDS) {
      user_cache.put(
        event_id,
        JSON.stringify([
          last_location,
          event_location,
          event_start_date.toISOString(),
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

    const description_list = [
      "Commute time",
      `From: ${last_location}`,
      `To: ${event_location}`,
    ];

    // TODO: go over all transport methods
    for (let transport of [PREFERRED_TRANSPORT]) {
      if (transport === PREFERRED_TRANSPORT) {
        description_list.push(`[x] ${title}`)
        continue;
      }

      // let duration = get_duration(origin, destination, arrive_time, mode);
      description_list.push(`[ ] ${title}`)
    }

    // adds in the description the even_id of the event it is tied to
    // description_list.push(EVENT_DESCRIPTION_ID_PREFIX + event_id);
    let buffer_time_event_description = description_list.join("\n");

    let buffer_time_event_title = title;
    let buffer_time_event_duration = duration_seconds;
    let buffer_time_event_start_date = new Date(event_start_date.getTime() - buffer_time_event_duration * 1000);
    let buffer_time_event_end_date = event_start_date;

    buffer_time_event = buffer_time_calendar.createEvent(
      buffer_time_event_title,
      buffer_time_event_start_date,
      buffer_time_event_end_date,
      {
        description: buffer_time_event_description
      }
    )

    console.log(`Buffer time event created: ${buffer_time_event}`)

    buffer_time_event_id = buffer_time_event.getId()
    console.log(`Buffer time event added to cache: ${event_id}`)
    user_cache.put(
      event_id,
      JSON.stringify([
        last_location,
        event_location,
        event_start_date.toISOString(),
        buffer_time_event_id,
      ]),
      THIRTY_DAYS_SECONDS
    )
  }
}
