# BurnedWolf Website (v1.7.0)

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

## v1.7.0'da yeni

- Tüm sürüm referansları **1.7.0** olarak güncellendi (hero, nav rozeti, indirme kartı, footer)
- İndirme dosyası: `Burnedwolf.Setup.1.7.0.exe`
- İndirme bölümünde **3 buton yan yana**:
  - 🟣 **İndir** — `https://github.com/iamnoobhasproject/app-updates/releases/download/.../Burnedwolf.Setup.1.7.0.exe`
  - ⬜ **Kaynak Kodu** — `https://github.com/iamnoobhasproject/burnedwolf-sourcecode`
  - ⬜ **Güncelleme Reposu** — `https://github.com/iamnoobhasproject/app-updates`
- Footer'da **Source Code** ve **Update Repo** linkleri eklendi
- Yeni `download.source_code`, `download.update_repo`, `footer.source_code`, `footer.update_repo` i18n anahtarları (TR/EN/RU)

## ⚠️ Release tag'ini güncellemeyi unutmayın

İndirme URL'sindeki release tag (`123f12okopw21dwqdqwfwqdf`) hâlâ 1.6.0'dan kalma. 1.7.0 release'i oluşturduktan sonra `index.html` içindeki indirme `href`'inde bu tag'i yeni release tag'i ile değiştirin.

## Özellikler

- **Dil seçimi**: İlk ziyarette TR / EN / RU sorulur. Seçim `localStorage` ile hatırlanır. Üst navigasyondan istediğin zaman değiştirilebilir.
- **Tema**: BurnedWolf Electron uygulamasının `#0A0A14` koyu zemini + `#A855F7` mor vurgusu + Inter / JetBrains Mono fontları.
- **Bölümler**: Hero · İstatistikler · 8 Özellik kartı · 4 Modül · 6 Adım kullanım rehberi · İndirme bölümü (3 buton) · 8 SSS · CTA · Footer
- **Animasyonlar**: Scroll-reveal, parallax orb, sayaç animasyonu, hover glow

## GitHub Pages'e deploy

```bash
cd website
git init
git add .
git commit -m "BurnedWolf landing site v1.7.0"
git branch -M main
git remote add origin git@github.com:iamnoobhasproject/burnedwolf-site.git
git push -u origin main
```

Sonra GitHub Settings → Pages → Source: `main / root` seçin.

## Yerel test

```bash
cd website
npx http-server -p 5173
```

`http://localhost:5173`
