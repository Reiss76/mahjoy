# MAH JOY original falling tiles

The homepages insert a scoped motion section after the four shop categories. Copy stays in English; controls follow the storefront language. Existing navigation, prices, promotions, checkout and footer stay outside the section.

The original free-falling composition uses 12 tiles on desktop and 9 on mobile. The larger pieces start suspended, then fall with scroll. `physics.mjs` restores the original deterministic Rapier simulation at 120 Hz, with conservative colliders and continuous collision detection. No physics engine runs in shoppers' browsers. `bake.mjs` stores both viewport profiles in one compact binary. The browser interpolates a shared timeline, including during reverse scrolling. The legacy `dragon` asset path and section anchor remain stable for existing links.

Regenerate and validate after changing geometry, physics or motion encoding:

```sh
node scripts/dragon/bake.mjs
node scripts/dragon/check.mjs
```

`check.mjs` tests the **production binary**, including interpolated quarter frames, against full oriented tile bounds and the floor. It also checks deterministic backward/forward seeking. Do not replace collision constraints with unrelated tile tweens.

Rendering uses instanced Three.js meshes with illustrative faces in the existing brand palette. Three.js is vendored under its accompanying MIT license. Rapier is a development dependency only. Geometry dimensions in `scene.js` and `physics.mjs` must stay consistent.

`load.js` imports the renderer only when the section approaches the viewport. Reduced-motion users and browsers without WebGL see the existing product photo and shop link. Sound is locally synthesized, requires an explicit click and never accesses a microphone. Rendering stops offscreen/in background tabs. There are no extra external APIs or trackers.

Remove the `mahjoy-dragon` section plus its stylesheet/module tags from both homepages to disable this feature. No catalog or order migration is needed.
