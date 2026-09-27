# pdf-to-jpg-core

Lossless PDF-to-JPEG extraction core — shared between the CLI bat tool and InducksScanUploader.

**Browser-safe.** No Node.js built-ins. Zero dependencies.

## Installation

```sh
npm install @starl/pdf-to-jpg-core --registry https://npm.pkg.github.com
```

Or add to `.npmrc`:

```
@starl:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## API

### `createIsu(impl)`

Creates the ISU adapter expected by the core libraries.

```js
import { createIsu } from '@starl/pdf-to-jpg-core'

const isu = createIsu({
  async inflate(bytes) { /* decompress zlib/deflate */ },
  async bytesAt(file, from, len) { /* read bytes from a File-like object */ },
  // optional:
  exifOrientation(bytes, view, from, to) { /* return 1–8 */ },
})
```

### `loadCore(isu, readFile, runInContext)`

Loads `pdf-core.js` and `jpeg-core.js` into a Node.js context and populates
`isu.pdfImages` and `isu.jpegCrop`.

```js
import { loadCore } from '@starl/pdf-to-jpg-core'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const pkgSrc = resolve(createRequire(import.meta.url).resolve('@starl/pdf-to-jpg-core'), '../')

loadCore(
  isu,
  (filename) => readFileSync(resolve(pkgSrc, filename), 'utf8'),
  (code, filename) => vm.runInThisContext(code, { filename }),
)

// Now available: isu.pdfImages(file), isu.jpegCrop.grid/crop/optimise(...)
```

In a **browser extension**, load `pdf-core.js` and `jpeg-core.js` as plain content scripts
— they self-install on `window.ISU`.

### `formatOutputName(template, vars)`

Resolves a filename template.

```js
import { formatOutputName } from '@starl/pdf-to-jpg-core'

formatOutputName('{name}_{page:04d}', { name: 'JM2045', page: 3, total: 52 })
// → 'JM2045_0003.jpg'

formatOutputName('{year}-{month}_{name}_p{page:03d}', { name: 'PM001', page: 12, total: 52 })
// → '2026-09_PM001_p012.jpg'
```

**Placeholders:**

| Placeholder   | Description                       | Example      |
|---------------|-----------------------------------|--------------|
| `{name}`      | PDF base name without extension   | `JM2045`     |
| `{page}`      | 1-based page number               | `7`          |
| `{page:03d}`  | Page zero-padded to N digits      | `007`        |
| `{total}`     | Total number of pages             | `52`         |
| `{date}`      | ISO date `YYYY-MM-DD`             | `2026-09-27` |
| `{year}`      | 4-digit year                      | `2026`       |
| `{month}`     | 2-digit month (01–12)            | `09`         |
| `{day}`       | 2-digit day (01–31)              | `27`         |

### `DEFAULT_OUTPUT_NAME_TEMPLATE`

```js
import { DEFAULT_OUTPUT_NAME_TEMPLATE } from '@starl/pdf-to-jpg-core'
// → '{name}_{page:04d}'
```

## Publishing

```sh
cd package
npm publish
```

Requires a GitHub token with `write:packages` scope in `~/.npmrc`:

```
//npm.pkg.github.com/:_authToken=ghp_...
```
