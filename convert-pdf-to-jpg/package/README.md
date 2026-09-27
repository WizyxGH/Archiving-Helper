# @wizyxgh/pdf-to-jpg-core

Lossless PDF-to-JPEG extraction core — browser-safe, pure JavaScript, zero external dependencies.

## Installation

```sh
npm install @wizyxgh/pdf-to-jpg-core --registry https://npm.pkg.github.com
```

Or configure in your `.npmrc`:

```ini
@wizyxgh:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## API

### `createIsu(impl)`

Creates the ISU adapter expected by the core libraries.

```javascript
import { createIsu } from '@wizyxgh/pdf-to-jpg-core'

const isu = createIsu({
  async inflate(bytes) { /* decompress zlib/deflate */ },
  async bytesAt(file, from, len) { /* read byte slice from file object */ },
  // optional:
  exifOrientation(bytes, view, from, to) { /* return EXIF orientation (1-8) */ },
})
```

### `loadCore(isu, readFile, runInContext)`

Loads `pdf-core.js` and `jpeg-core.js` into a Node.js context and populates `isu.pdfImages` and `isu.jpegCrop`.

```javascript
import { loadCore } from '@wizyxgh/pdf-to-jpg-core'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const pkgSrc = resolve(createRequire(import.meta.url).resolve('@wizyxgh/pdf-to-jpg-core'), '../')

loadCore(
  isu,
  (filename) => readFileSync(resolve(pkgSrc, filename), 'utf8'),
  (code, filename) => vm.runInThisContext(code, { filename }),
)

// Available: isu.pdfImages(file), isu.jpegCrop.grid/crop/optimise(...)
```

In browser extensions or web pages, `pdf-core.js` and `jpeg-core.js` can also be loaded directly as content scripts (`window.ISU`).

### `formatOutputName(template, vars)`

Resolves custom file naming patterns.

```javascript
import { formatOutputName } from '@wizyxgh/pdf-to-jpg-core'

formatOutputName('{name}_{page:04d}', { name: 'JM2045', page: 3, total: 52 })
// → 'JM2045_0003.jpg'
```

## License

MIT
