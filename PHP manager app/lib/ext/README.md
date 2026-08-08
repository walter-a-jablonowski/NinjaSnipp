# Third party front-end libraries

Local copies so the app works without an internet connection. Keep them committed.

| File | Library | Version |
|---|---|---|
| `bootstrap.min.css`, `bootstrap.bundle.min.js` | [Bootstrap](https://getbootstrap.com/) | 5.3.2 |
| `bootstrap-icons.css`, `fonts/bootstrap-icons.woff`, `fonts/bootstrap-icons.woff2` | [Bootstrap Icons](https://icons.getbootstrap.com/) | 1.11.1 |
| `marked.min.js` | [marked](https://marked.js.org/) | 15.0.12 |

`bootstrap-icons.css` loads its fonts through the relative path `./fonts/`, so the
`fonts` folder has to stay next to it.

### Updating

Replace a file and bump the version in the table. `index.php` stamps each asset with its
file mtime, so a new copy invalidates the browser cache on its own.

```
curl -o bootstrap.min.css        https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css
curl -o bootstrap.bundle.min.js  https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js
curl -o bootstrap-icons.css      https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css
curl -o fonts/bootstrap-icons.woff2  https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/fonts/bootstrap-icons.woff2
curl -o fonts/bootstrap-icons.woff   https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/fonts/bootstrap-icons.woff
curl -o marked.min.js            https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js
```

Note that `marked` was previously loaded unpinned (`npm/marked/marked.min.js`), which
resolved to whatever was current. It is pinned here.
