# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Browser-based ESP32 simulator: users write Arduino C/C++, wire parts on a canvas, and run it in the browser with real WiFi/HTTP/MQTT. Plain ES modules, **no build step and no npm dependencies** (Node ≥ 18 only). Third-party libs (CodeMirror 5, mqtt.js) are vendored in `vendor/` and loaded as globals via `<script>` in `index.html`; everything in `js/` is loaded as modules from `js/main.js`.

User-facing text (UI, compile errors, warnings, README) is in **Vietnamese** — keep new messages consistent with that.

## Commands

```bash
npm start                                    # node server.js → http://127.0.0.1:8080/
npm test                                     # compile all examples, then run them against the circuit solver
node tests/compile_examples.mjs              # compile-only check of every example in js/examples.js
node tests/run_examples.mjs <exampleId> [ms] # run one example (id from EXAMPLES) for ms (default 1500)
node tests/harness.mjs tests/t_basic.ino [ms] [v]   # run a single sketch with a fake circuit; 'v' prints generated JS
node tests/t_irq.mjs                         # interrupt test (pir-interrupt example)
```

There is no assertion framework or linter: tests print Serial output / pin snapshots, and you inspect the output. `run_examples.mjs` honors `DBG=1` for extra GPIO dumps.

## Architecture

The pipeline is: **sketch source → compiler → JS source string → `Runtime` executes it, talking to a `Circuit` (the "sim")**. Compiler, runtime and circuit are DOM-free and run in Node, which is how the tests work; `js/main.js` and `js/circuit/editor.js` are the browser-only layers.

### Compiler (`js/compiler/`)
- `lexer.js`: preprocessor (`#define`, function macros, `#if`) + tokenizer; collects `#include`s. `CompileError` carries GCC-style line/col messages.
- `parser.js`: tokens → AST. It must be told which identifiers are type names (library classes from `LIBS`, JSON types, FreeRTOS types — see `compile.js`).
- `codegen.js`: AST → JS. Tracks static C types to emulate integer overflow/width, integer division, float printing (2 decimals), and Arduino `String` semantics. **Every user function is generated as `async`** so `delay()` can suspend; loops get a cooperative-yield counter (`YIELD` constant). Built-ins that suspend must be listed in `ASYNC_FUNCS`.
- `compile.js`: entry point; `SUPPORTED_HEADERS` controls the "unsupported library" warning.

Generated code returns `{init, setup, loop}` and references runtime helpers via `$` (`R.h`), built-in functions via `R.f`, and global objects (`Serial`, `WiFi`, `Wire`, …) via `R.o`.

### Runtime (`js/runtime/`)
- `runtime.js`: `Runtime` class — Arduino core functions, cooperative scheduler (delay, FreeRTOS tasks, ISR queue drained during `delay`/yield), stop via `StopSignal`/`stopPromise`. Constructed with `{ sim, io, settings }`; `io` is the UI callback interface (`serialWrite`, `log`, `net`, `wifi`, `restart`, `onStopped`).
- `libs.js`: simulated libraries. Each class is constructed as `new Cls(R, ...ctorArgs)` and must be registered in `LIBS`. `static meta = { ret: {...} }` declares method return types for the compiler (affects print formatting/arithmetic).
- `meta.js`: return types of global functions (`FUNCS`), constants, global objects — the compiler's view of the API surface. Adding a built-in function means implementing it in `runtime.js` (`makeFuncs`) **and** declaring it in `FUNCS`.
- `format.js`: printf/strftime and string encoding. Serial/strings are handled as byte ("bin") strings internally; convert with `binToUtf8`/`utf8ToBin`.

### Boards (`js/boards.js`)
`BOARDS` (keyed by part type: `esp32-iot-esp32-devkit-v1`, `board-xiao-esp32-c3`, `board-xiao-esp32-s3`, `board-esp32-c3-supermini`) gives each board's header pin → GPIO map, power pins, on-board LED/BOOT GPIO, `pins_arduino.h` constants and target macros; `CHIPS` gives per-chip valid/flash/input-only GPIOs, ADC1/ADC2, core count, boot banner. The compiler takes `compile(src, { board })` (constants are inlined at compile time; `boardConsts()` maps a removed constant to null → "not declared"), the runtime reads `sim.boardType()` (DevKit when absent, as in `fakeSim`), and the circuit finds the board as the part whose type is in `BOARDS`. Adding a board = an entry in `BOARDS` + its part in `parts.js` (`smallBoard()` for two-row boards). `tests/t_boards.mjs` checks the board-specific behaviour.

The board is chosen with the `#boardSelect` dropdown (boards are hidden from the part palette). `js/port.js` `portProject({code, diagram}, board)` moves a project to another board: source GPIOs get roles (I2C from wires to an `i2c` part's SDA/SCL, analog from pot/LDR pins or `analogRead`, BOOT, generic) and are re-assigned using each board's `prefer` lists (same GPIO, or same D-pin between XIAOs); board wires are re-attached and routed with `route.js`, parts right of/below the board are shifted by the size difference, pins keep their top-to-bottom order per header side and prefer the side facing their part, parts wired straight across to the board (with the parts wired to them) are moved to the new pin's row when they fit, pin tokens in the sketch (literals/`#define`/initializers reaching pin calls, `A0`/`D10`… constants) are rewritten, and a missing on-board LED/BOOT becomes an external LED+resistor/push button. Examples are always opened through it for the selected board; `tests/t_port.mjs` runs every example on every board.

### Circuit (`js/circuit/`)
- `parts.js`: `PARTS` registry — per part: size, pins, SVG `render()`, visual `update()`, and electrical behavior via `links()` (pin connections, e.g. switches) and `drive()` (voltage sources). Part type ids are `esp32-iot-*` (`esp32-iot-led`, `esp32-iot-esp32-devkit-v1`, …; `board-*` for the small boards; old `wokwi-*` ids are mapped on load) and diagrams use the `diagram.json` format.
- `circuit.js`: `Circuit` is the `sim` the runtime calls (`pinMode`, `digitalWrite`, `readVoltage`, `setPwm`, `findI2C`, `findOnPin`, …). Wires/closed switches merge pins into nets (union-find); drivers fix net voltages; resistors/pull-ups/pots are solved by nodal analysis. Lazily recomputed: call `invalidate()` after state changes, `ensure()` before reading. `tests/harness.mjs` has `fakeSim()`, a minimal stand-in implementing the same interface.
- `editor.js`: canvas UI (drag/drop, wires, zoom/pan).
- `route.js`: orthogonal wire router (`routeWires(parts, wires)` fills `points` of wires that have `null`): each wire leaves its pin straight out of the part, then A* over the channel lines around the part boxes, costed by length, bends, crossings/overlaps with wires of *other* nets (same-net wires may share paths) — first pass in order, then rip-up-and-reroute passes with a rising crossing cost (`COST`). Used for new wires without hand-placed bends, wires of a moved/rotated part (unless their bends were edited, `w.manual`), and by `port.js`.

### Other
- `server.js`: static file server + `/__proxy` HTTP proxy (bound to 127.0.0.1) so simulated `HTTPClient` avoids CORS. Env: `HOST`, `PORT`, `PROXY_BLOCK_PRIVATE=1` (proxy refuses loopback/private/link-local targets, re-checked on each redirect — set in the Docker image for public deployment; see `DEPLOY.md`: image built and pushed to Docker Hub by `deploy/push.ps1`, VPS runs `docker-compose.yml` + `.env` behind nginx from `deploy/`). MQTT goes over WebSocket via mqtt.js; TCP broker addresses are mapped to WS URLs (mapping editable in settings).
- `js/examples.js`: `EXAMPLES` (id, code, diagram) — also the main test corpus, so new features should usually get an example.

## Known limitations (by design)
Code is transpiled to JS, not Xtensa emulation (wall-clock timing). Not supported: user classes with methods, user templates, `new`/`delete`, `goto`, raw TCP sockets. The circuit model is DC-only; LEDs/diodes are not modeled as conducting elements.
