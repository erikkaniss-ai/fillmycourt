// Strict local validation for the opt-in Playtomic companion response.
// This is not a provider adapter: it accepts no credentials, makes no network
// requests, and rejects every provider other than the companion's one narrow UI
// observation format.
(function(root) {
  "use strict";
  // Per-provider routes represent individual player-visible booking surfaces.
  // Directory or club-admin pages do NOT become priced inventory by themselves.
  const SOURCE_URLS = Object.freeze({
    playtomic:/^https:\/\/playtomic\.com\/clubs\/[a-z0-9-]+$/,
    tiesports:/^https:\/\/clubs\.tiesports\.com\/(?:en|pt)\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/,
    racket_id:/^https:\/\/racket\.id\/booking$/,
    smashpro:/^https:\/\/smashpro\.pt\/pt\/c\/[a-z0-9-]+$/,
    matchi:/^https:\/\/www\.matchi\.se\/facilities\/[a-z0-9_-]+$/
  });
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_LABEL = /^(?:[1-9]|1[0-2]):[0-5]\d [AP]M$/;
  const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  function text(value, label, maximum) {
    if (typeof value !== "string" || !value || value !== value.trim() || value.length > maximum)
      throw Error("Invalid " + label + ".");
    return value;
  }

  function instant(value) {
    if (typeof value !== "string" || !INSTANT.test(value) || !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString() !== value)
      throw Error("Invalid capture time.");
    return value;
  }

  function calendarDate(value) {
    if (typeof value !== "string" || !DATE.test(value)) throw Error("Invalid observed date.");
    const [year, month, day] = value.split("-").map(Number);
    if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== value)
      throw Error("Invalid observed date.");
    return value;
  }

  function offer(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid observed offer.");
    const court = text(value.court, "court", 100);
    const startLabel = text(value.startLabel, "start time", 16);
    const endLabel = text(value.endLabel, "end time", 16);
    if (!TIME_LABEL.test(startLabel) || !TIME_LABEL.test(endLabel)) throw Error("Invalid observed time.");
    if (!Number.isInteger(value.durationMinutes) || value.durationMinutes < 1 || value.durationMinutes > 360)
      throw Error("Invalid observed duration.");
    if (!Number.isFinite(value.priceEur) || value.priceEur <= 0 || value.priceEur > 2000)
      throw Error("Invalid observed price.");
    return Object.freeze({court, startLabel, endLabel, durationMinutes:value.durationMinutes, priceEur:value.priceEur});
  }

  function validateObservation(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid source observation.");
    if (value.source !== "user_ui_observation" || !Object.hasOwn(SOURCE_URLS,value.provider) ||
        typeof value.sourceUrl !== "string" || !SOURCE_URLS[value.provider].test(value.sourceUrl) ||
        value.timezone !== null || value.sourceFreshness !== "unknown" ||
        value.coverage !== "expanded_offers_only")
      throw Error("Unapproved source observation.");
    const venue = text(value.venue, "venue", 160);
    const date = calendarDate(value.date);
    if (value.sport !== "Padel" && value.sport !== "Tennis") throw Error("Invalid observed sport.");
    if (!Array.isArray(value.offers) || value.offers.length < 1 || value.offers.length > 20)
      throw Error("Invalid observed offer count.");
    return Object.freeze({
      provider:value.provider, source:"user_ui_observation", sourceUrl:value.sourceUrl,
      venue, date, sport:value.sport, capturedAt:instant(value.capturedAt),
      timezone:null, sourceFreshness:"unknown", coverage:"expanded_offers_only",
      offers:Object.freeze(value.offers.map(offer))
    });
  }

  const api = Object.freeze({validateObservation});
  root.GetACourtPersonalSourceObservation = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
