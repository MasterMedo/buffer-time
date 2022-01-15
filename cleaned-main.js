const TRAVEL_TIME_CALENDAR = 'Travel time';
const PREFERRED_TRANSPORT = Maps.DirectionFinder.Mode.DRIVING;
const EMOJI = {driving: '🚗', walking: '🚶', bicycling: '🚴', transit: '🚆'};
const FOUR_HOURS_SECONDS = 4 * 60 * 60;
const FIVE_HOURS_SECONDS = 5 * 60 * 60;
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

const divmod = (x, y) => [Math.floor(x / y), x % y];


/**
 * Calculates the travel duration between the origin location and the
 * destination location using the Google Maps API.
 * Already executed query results are cached.
 *
 * @param  {String} origin       Origin location.
 * @param  {String} destination  Destination location.
 * @param  {DateTime} arriveTime Destination arrival time.
 * @param  {String} transport    A mode from `Maps.DirectionFinder.Mode`.
 * @return {Integer}             Duration in seconds or `undefined`.
 */
function getDuration(origin, destination, arriveTime, transport) {
  const cache = CacheService.getUserCache();
  const key = JSON.stringify([origin, destination, transport]);

  const duration = cache.get(key);
  if (duration !== null) { // if key is not in cache (could be undefined)
    try {
      const n = Number(duration);
      console.log(`Google maps cache kicked in: ${key}: ${n} seconds`);
      return n;
    } catch (err) {
      return undefined; // a path doesn't exist
    }
  }

  const durationSeconds = Maps.newDirectionFinder()
      .setOrigin(origin)
      .setDestination(destination)
      .setArrive(arriveTime)
      .setMode(transport)
      .getDirections()
      .routes[0]?.legs[0]?.duration?.value;

  if (!!durationSeconds) {
    cache.put(key, JSON.stringify(durationSeconds), THIRTY_DAYS_SECONDS);
  } else {
    cache.put(key, 'undefined', THIRTY_DAYS_SECONDS);
  }

  return durationSeconds;
}

/**
 * Formats the commute/travel duration to a readable format. The output is
 * similar to the following format:
 *
 *   🚗 Driving 3 hours 23 minutes
 *   🚴 Bicycling 56 minutes.
 *
 * @param {Integer} durationSeconds Commute/travel duration in seconds.
 * @param {String} transport        A mode from `Maps.DirectionFinder.Mode`.
 * @return {String}                 Formatted text title.
*/
function secondsToText(durationSeconds, transport) {
  const minutesPre = Math.floor(durationSeconds / 60);
  const [hours, minutes] = divmod(minutesPre, 60);

  let title = `${EMOJI[transport]} ${transport} `;
  if (hours) {
    title += `${hours} hours `;
  }
  if (minutes) {
    title += `${minutes} minutes`;
  }
  return title;
}


/**
 * Creates "Travel time" calendar events that represent commute/travel times
 * from an origin location to the destination location so that the user is
 * aware when it's best to get going.
 *
 * 1. Creates or fetches the "travel time calendar".
 * 2. Fetches all events from all user calendars.
 * 3. Sorts all events by start time.
 * 4. For each event calculates commute/travel time from last event's
 * location to the location of the current event.
 * 5. Creates a "travel time" event before each event where the commute
 * duration is less than 5 hours and the last known location time was less
 * than 4 hours ago.
 */
function main() {
  const travelTimeCalendars = CalendarApp
      .getOwnedCalendarsByName(TRAVEL_TIME_CALENDAR);
  let travelTimeCalendar = undefined;
  if (travelTimeCalendars.length === 0) {
    travelTimeCalendar = CalendarApp.createCalendar(TRAVEL_TIME_CALENDAR);
    console.log('Travel time calendar created!');
  } else {
    travelTimeCalendar = travelTimeCalendars[0];
  }
  const primaryCalendar = CalendarApp.getDefaultCalendar();

  const timeZone = primaryCalendar.getTimeZone();
  const today = new Date(new Date().setHours(0, 0, 0, 0));

  // google script doesn't provide a method to get first day of the week
  const weekDay = Utilities.formatDate(today, timeZone, 'u');
  const yesterday = new Date(today.getTime() - 864e5);
  const nextSunday = new Date(today.getTime() + 864e5 * (15 - weekDay));

  const calendars = CalendarApp.getAllOwnedCalendars();
  let allEvents = [];
  for (const calendar of calendars) {
    if (calendar.getId() !== travelTimeCalendar.getId()) {
      allEvents = allEvents.concat(calendar.getEvents(yesterday, nextSunday));
    }
  }

  allEvents.sort(function(event1, event2) { // sorts events by start_time
    const event1StartDate = event1.getStartTime();
    const event2StartDate = event2.getStartTime();
    if (event1StartDate < event2StartDate) {
      return -1;
    } else if (event1StartDate > event2StartDate) {
      return 1;
    } else {
      return 0;
    }
  });

  // gets user cache, the cache cannot be cleared except key by key
  // this is why we set the cache to 30 days
  const userCache = CacheService.getUserCache();

  let lastLocation = undefined;
  let lastLocationDate = undefined;
  let eventLocation = undefined;
  let eventStartDate = undefined;

  for (const event of allEvents) {
    if (!!eventLocation) { // if old event location exists
      lastLocation = eventLocation;
      lastLocationDate = event.getEndTime();
    }

    eventStartDate = event.getStartTime();

    eventLocation = event.getLocation();
    if (event.isAllDayEvent()) { // if event is an all day event
      continue;
    }

    if (!!lastLocation) { // if last location exists
      // if more than four hours passed since user was at last location
      if (eventStartDate - lastLocationDate >= FOUR_HOURS_SECONDS * 1000) {
        lastLocation = undefined;
        lastLocationDate = undefined;
      }
    }

    if (!lastLocation) {
      continue;
    }

    if (event.isRecurringEvent()) {
      continue;
    }

    const eventId = event.getId();
    const travelTimeEventCached = userCache.get(eventId);
    if (!!travelTimeEventCached) { // if event cached
      console.log(`Log: Event is cached: ${travelTimeEventCached}`);
      const [
        origin,
        destination,
        startDate,
        travelTimeEventId,
      ] = JSON.parse(travelTimeEventCached);
      if (
        origin !== lastLocation ||
        destination !== event.getLocation() ||
        startDate !== eventStartDate.toISOString()
      ) { // if origin, destination or startDate changed
        if (!!travelTimeEventId) {
          // sometimes this returns an event object even if the user deleted it
          travelTimeEvent = travelTimeCalendar.getEventById(
              travelTimeEventId,
          );
          try {
            travelTimeEvent.deleteEvent();
          } catch (err) {
            // the user deleted the event already
          }
          userCache.remove(event.getId());
          console.log(`Travel time event deleted from cache ${event.getId()}`);
        }
      } else { // origin, destination and startDate didn't change
        continue;
      }
    } // if event cached

    if (!eventLocation || eventLocation === lastLocation) {
      continue;
    }

    if (![
      CalendarApp.GuestStatus.OWNER,
      CalendarApp.GuestStatus.MAYBE,
      CalendarApp.GuestStatus.YES,
    ].includes(event.getMyStatus())) {
      continue;
    }

    const transportMode = PREFERRED_TRANSPORT;
    const durationSeconds = getDuration(
        lastLocation,
        eventLocation,
        eventStartDate,
        transportMode,
    );

    if (!durationSeconds) { // path doesn't exist
      continue;
    }

    if (durationSeconds > FIVE_HOURS_SECONDS) {
      userCache.put(
          eventId,
          JSON.stringify([
            lastLocation,
            eventLocation,
            eventStartDate.toISOString(),
            undefined,
          ]),
          THIRTY_DAYS_SECONDS,
      );
      continue;
    }

    const title = secondsToText(durationSeconds, transportMode);

    const descriptionList = [
      'Commute time',
      `From: ${lastLocation}`,
      `To: ${eventLocation}`,
    ];

    descriptionList.push(`${title}`);
    const travelTimeEventDescription = descriptionList.join('\n');
    const travelTimeEventTitle = title;
    const travelTimeEventDuration = durationSeconds;
    const travelTimeEventStartDate = new Date(
        eventStartDate.getTime() - travelTimeEventDuration * 1000,
    );
    const travelTimeEventEndDate = eventStartDate;

    travelTimeEvent = travelTimeCalendar.createEvent(
        travelTimeEventTitle,
        travelTimeEventStartDate,
        travelTimeEventEndDate,
        {
          description: travelTimeEventDescription,
        },
    );

    console.log(`Travel time event created: ${travelTimeEvent}`);

    travelTimeEventId = travelTimeEvent.getId();
    console.log(`Travel time event added to cache: ${eventId}`);
    userCache.put(
        eventId,
        JSON.stringify([
          lastLocation,
          eventLocation,
          eventStartDate.toISOString(),
          travelTimeEventId,
        ]),
        THIRTY_DAYS_SECONDS,
    );
  }
}
