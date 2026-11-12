# Cabin Crew Call

A just-for-fun single-page PWA for Android phones and tablets: the overhead passenger service unit (PSU) of an airliner.

- **Reading lights** A/B/C: tap the bulb button to switch a seat's light on or off.
- **Air vents** A/B/C: tap to twist the nozzle: off → low → high → off. You hear a soft air hiss.
- **Swivelling heads**: like on a real panel, every lamp and air nozzle points somewhere else. Drag one to aim it; the
  light spill and the air flow follow. Each head mostly covers its own seat and turns only slightly toward a neighbour.
  Aim a lit lamp straight at yourself and it is blinding, like a real reading light.
- **Cabin crew call**: the blue button plays the chime and stays lit blue until you press it again, like on a real aircraft.
- **Moving map (IFE)**: a small overhead screen that loops like a real in-flight entertainment moving map. Tap it to enlarge,
  tap again (or press Back) to shrink it. The loop:

  | Screen                                      | Shown for |
  | ------------------------------------------- | --------- |
  | Large moving map (route, cities, day/night) | 40 s      |
  | Flight progress summary                     | 15 s      |
  | Small map + flight statistics               | 15 s      |
  | Altitude / speed / outside temperature      | 12 s      |
  | Destination weather (live, Open-Meteo)      | 15 s      |
  | Time / distance remaining                   | 15 s      |
  | Tail camera (only in daylight)              | 25 s      |

- **Preferences** (gear button): your seat (row number and A B C / D E F / H J K), flight region (Europe by default, North America, Asia & Middle East, anywhere), metric or
  imperial units, 24- or 12-hour clock, display on/off and “Another flight”.

The flights are real: callsign, airline, aircraft and route come from a snapshot of aircraft that were airborne when the
snapshot was taken. Free flight trackers don't allow browser access from other sites (no CORS), so the position is
simulated along the great-circle route in real time (climb, cruise, descent), starting somewhere mid-flight.

The state is remembered between visits. After the first visit the app works offline and can be installed to the home screen.

## Development

```sh
pnpm install
pnpm dev        # dev server
pnpm build      # type-check + production build into dist/
pnpm preview    # serve dist/
pnpm test       # unit tests (Vitest)
pnpm test:e2e   # end-to-end tests on Android phone & tablet profiles (Playwright)
pnpm lint
pnpm update:flights  # refresh src/ife/flights.json (needs network; clones VRS standing data into tmp/)
```

Icons are generated at build time from [public/favicon.svg](public/favicon.svg) by `@vite-pwa/assets-generator`.

## Credits

- Chime: [“chime.wav”](https://freesound.org/s/245851/) by Shamrock132, an Airbus A320 interphone chime, released under
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). [public/sounds/call-chime.mp3](public/sounds/call-chime.mp3)
  is the first (high) chime of that recording, trimmed with a fade-out and loudness-normalized.
- Button click: [“dipswitch on off”](https://commons.wikimedia.org/wiki/File:Dipswitch_on_off.ogg) by stephan
  (pdsounds.org), a reading flashlight switch, in the public domain.
  [public/sounds/switch-click.wav](public/sounds/switch-click.wav) is the first (switch-on) click of that recording.
- The no-smoking and fasten-seat-belt pictograms ([public/icons/](public/icons/)) are drawn in SVG after the common
  amber backlit cabin signs.
- The panel is drawn in CSS/SVG after the photo
  [PECO Passenger Service Unit](https://commons.wikimedia.org/wiki/File:PECO_Passenger_Service_Unit.jpg) by Mottsarah
  (CC BY-SA 4.0). The app does not use or include the photo.
- Flight snapshot ([src/ife/flights.json](src/ife/flights.json)): airborne traffic from the [adsb.lol](https://adsb.lol)
  API ([ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)), with routes, airports, airlines and aircraft types from
  the [Virtual Radar Server standing data](https://github.com/vradarserver/standing-data)
  ([CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)). adsbdb.com routes are not used, because their terms
  don't allow copying them into other databases.
- Weather: [Open-Meteo](https://open-meteo.com/) ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).
- Map: [Natural Earth](https://www.naturalearthdata.com/) (public domain) via
  [world-atlas](https://github.com/topojson/world-atlas) (ISC).
