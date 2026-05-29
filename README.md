# BurnedWolf Website

Resmi BurnedWolf tanıtım sitesi. Tek sayfa (SPA değil, statik), 3 dilli (TR / EN / RU), Electron uygulamasının mor + koyu temasına %100 sadık.

## Yapı

```
website/
├── index.html         # Ana sayfa + dil seçim overlay'i
├── .nojekyll          # GitHub Pages için
├── assets/
│   └── icon.png       # Uygulama ikonu
├── css/
│   └── style.css      # Tüm stiller
└── js/
    ├── i18n.js        # 3 dil sözlüğü
    └── main.js        # Runtime (dil + interaktiflik)
```

## Özellikler

- **Dil seçimi**: İlk ziyarette TR / EN / RU sorulur. Seçim `localStorage` ile hatırlanır. Daha sonra üst navigasyondan istediğin zaman değiştirilebilir.
- **Tarayıcı dili algılama**: Cihazın varsayılan dili desteklenenler arasındaysa overlay atlanır.
- **Tema**: Burnedwolf Electron uygulamasının `#0A0A14` koyu zemini + `#A855F7` mor vurgusu + Inter / JetBrains Mono fontları.
- **Bölümler**: Hero · İstatistikler · 8 Özellik kartı · 4 Modül (DPI / Discord / Verify / Spotlight) sahte ekran görüntüleri ile · 6 Adım kullanım rehberi · İndirme bölümü · 8 SSS · CTA · Footer
- **İndirme**: Direkt link
  ```
  https://github.com/iamnoobhasproject/app-updates/releases/download/123f12okopw21dwqdqwfwqdf/Burnedwolf.Setup.1.6.0.exe
  ```
- **Animasyonlar**: Scroll-reveal, parallax orb, sayaç animasyonu, hover glow

## GitHub Pages'e deploy

1. Bu `website/` klasörünü ayrı bir repo'ya at (örn. `burnedwolf-site`) **veya** ana repo'da `gh-pages` branch'ine koy.
2. Repo Settings → Pages → Source: `main` branch, root `/` (veya `gh-pages` branch).
3. Birkaç dakika içinde `https://<kullanıcı>.github.io/<repo>/` adresinden açılır.

### Yöntem 1: Ayrı repo

```bash
cd website
git init
git add .
git commit -m "BurnedWolf landing site"
git branch -M main
git remote add origin git@github.com:iamnoobhasproject/burnedwolf-site.git
git push -u origin main
```

Sonra GitHub UI'dan Pages'i aktifleştir.

### Yöntem 2: gh-pages branch

```bash
cd website
git checkout --orphan gh-pages
git rm -rf .
# (website dosyalarını kopyala)
git add .
git commit -m "site"
git push origin gh-pages
```

## Yerel test

Dosya protokolünden değil `http://` üzerinden açılması gerekir (fetch / font / CORS için). En basit yöntemler:

```bash
# Python varsa
python -m http.server 8080

# Node varsa
npx serve .
```

Sonra `http://localhost:8080`.

## Notlar

- `localStorage` temizlenirse veya gizli sekmede ilk açılışta tekrar dil overlay'i gelir.
- Tarayıcı dili `tr`, `en` veya `ru` ise overlay otomatik atlanır.
- Tüm SVG ikonlar inline (CSP-friendly, harici icon kütüphanesine bağımlı değil).
- Mobil duyarlı (520px ve 920px breakpoint'leri).
