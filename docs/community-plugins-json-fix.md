# Fixing `community-plugins.json` parse failures

If CI reports an error like:

```
Could not parse `community-plugins.json`, invalid JSON.
Expected ',' or '}' after property value in JSON at position <N>
```

use the position `<N>` to inspect the exact area quickly.

## 1) Locate the broken area

```bash
node scripts/find-json-error.mjs community-plugins.json <N>
```

Example for your log:

```bash
node scripts/find-json-error.mjs community-plugins.json 645692
```

This prints:
- line/column equivalent for the byte position
- ~240 chars of surrounding context
- `JSON.parse` error message

## 2) Typical fixes

Near that location, look for one of these:
- missing comma between properties in an object
- missing comma between items in an array
- missing closing `}` or `]`
- accidental trailing character
- unescaped quote in a string value

## 3) Re-validate before push

```bash
node -e "JSON.parse(require('node:fs').readFileSync('community-plugins.json','utf8')); console.log('OK')"
```

If this prints `OK`, the syntax error is resolved.
