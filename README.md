# Stock Matching Platform

ERP stoklarini senkronize eden, dokumanlardan siparis satiri cikaran, satir-bazli stok eslestiren ve kullanici geri bildirimiyle ogrenen monorepo.

## Guncel Mimari

Docker compose ile 6 servis calisir:

- `matching_db` (PostgreSQL)
- `migrate` (tek seferlik migration runner)
- `sync-service` (ERP -> matching DB senkronizasyonu)
- `matching-api` (HTTP API + UI + eslestirme)
- `ocr-service` (PaddleOCR tabanli OCR)
- `order-dispatcher` (kuyruktaki siparisleri ERP endpointine retry ile gonderir)

Dosya: `docker-compose.yml`

## Docker'da Lookup Testi

Hareket kodu gibi lookup alanlari `matching-api` icindeki `/lookups/:lookupKey` endpoint'i uzerinden cekilir.
Container ortam degiskenleri `.env` icinden gelir. Yeni lookup ayarlari eklenince `matching-api` image'ini rebuild edip container'i recreate etmek gerekir.

Ornek `.env` anahtarlari:

- `UYUM_LOOKUP_BASE_URL=http://10.0.1.16:600`
- `UYUM_LOOKUP_USER=WEBSERVIS`
- `UYUM_LOOKUP_PASSWORD=...`
- `UYUM_LOOKUP_BEARER_TOKEN=...`
- `UYUM_LOOKUP_SECRET_KEY=...`

Docker uzerinden test akisi:

1. `docker compose build matching-api`
2. `docker compose up -d matching-api`
3. `docker compose logs -f matching-api`
4. Ayrica endpoint testi: `http://localhost:8080/lookups/movement-codes`

PowerShell ile hizli dogrulama:

```powershell
Invoke-RestMethod -Uri "http://localhost:8080/lookups/movement-codes" -Method Get
```

Beklenen sonuc:

- `items[].value` alaninda hareket kodu doner. Ornek: `TES-101`
- `items[].label` alaninda dropdown metni doner. Ornek: `TES-101 SATIS TEKLIF`

Not:

- Bu Uyum endpoint'i Basic auth ile calismiyor olabilir.
- Loglardan gelen sonuca gore endpoint `Authorization: Bearer ...` ve `UyumSecretKey` header'larini bekliyor.
- Bu durumda `UYUM_LOOKUP_BEARER_TOKEN` ve `UYUM_LOOKUP_SECRET_KEY` alanlarini doldurmaniz gerekir.

UI testi:

1. Uygulamayi acin.
2. `Teklif Bilgileri` panelini genisletin.
3. `Hareket Kodu` dropdown'unda API'den gelen kayitlarin listelendigini kontrol edin.

## Docker Dev Modu

Kod degisikligini hizli test etmek icin ayri bir dev compose dosyasi vardir:

- `docker-compose.dev.yml`

Bu servis:

- kaynak kodu container icine bind mount eder
- `matching-api` servisini `node --watch` ile calistirir
- `.ts` dosyalari degistiginde container icinde sureci otomatik yeniden baslatir
- uygulamayi `http://localhost:8081` uzerinden acar

Ilk calistirma:

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d matching_db ocr-service migrate matching-api-dev
```

Log izleme:

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f matching-api-dev
```

Kullanim:

1. `apps/matching-api/src` altinda kodu degistirin.
2. Log ekraninda `Restarting` benzeri yeniden baslama ciktilarini bekleyin.
3. Tarayicidan `http://localhost:8081` adresini yenileyin.

Notlar:

- Bu mod hizli gelistirme icindir, production benzeri degildir.
- `package.json` veya lock dosyasi degisirse dev servisini yeniden olusturmak daha sagliklidir.
- Sadece `.env` degisti ise su komut yeterlidir:

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --force-recreate matching-api-dev
```

## Uctan Uca Akis

### 1. ERP Senkronizasyonu

1. `sync-service`, ERP view'dan satirlari okur.
2. `stock_master` tablosuna upsert eder.
3. `stock_features` tablosuna parser/feature extraction sonucu yazar.
4. Periyodik tekrarlar (`SYNC_INTERVAL_SECONDS`).

Kod:
- `apps/sync-service/src/index.ts`
- `packages/common/src/extractors.ts`

### 2. Kaynak Cozumleme (`/extract-source`)

Girdi tipine gore farkli hat:

- `plain_text`: dogrudan parser
- `excel`: kolon-esleme + satir uretimi
- `docx`, `pdf_text`: text extraction + parser
- `image`, `pdf_scanned`: OCR + parser

Image OCR sirasi:

1. Google Vision (varsa)
2. `ocr-service` (`/ocr`)
3. Tesseract fallback

Parser yetersizse LLM fallback devreye girer (text/image varyanti).

Kod:
- `apps/matching-api/src/source-extract.ts`
- `apps/matching-api/src/ai-extract.ts`
- `packages/common/src/order-parser.ts`

### 3. Eslestirme (`/match`)

1. Input'tan feature extraction (seri, temper, olcu, urun tipi)
2. SQL candidate retrieval (`pg_trgm similarity` + filtreler)
3. Kural tabanli scoring (`@smp/common` tek kaynak)
4. Instruction bazli filter/boost
5. Gecmis secimlerden learning boost
6. ML rerank (lokal model veya harici rerank servisi)
7. Sonuc `match_history`'ye kayit

Kod:
- `apps/matching-api/src/index.ts`
- `packages/common/src/scoring.ts`
- `apps/matching-api/src/ml.ts`

### 4. Feedback ve Ogrenme

- `/feedback`: secilen stok kaydedilir.
- `/profiles/save`: extraction profili kaydedilir.
- `/profiles/confirm`: profile geri bildirim yazilir.
- `matching-api` 5 dakikada bir `match_history` uzerinden ML modeli retrain eder.

Kod:
- `apps/matching-api/src/extraction-learning.ts`

### 4.1 Ogrenme Metodolojisi (Detayli)

Bu bolum extraction + eslestirme ogrenmesinin nasil calistigini netlestirir.

#### A) Ogrenme neye dayanir

Sistem profili dosya adina gore degil, asagidaki sinyallere gore eslestirir:

- `source_type` (image, excel, plain_text, ...)
- `mime_type`
- Excel ise: kolon adlari (`headers`) ve sayfa adlari (`sheet_names`)
- Metin/gorselden normalize edilmis ornek icerik (`sample`)
- Kullanicinin verdigi talimat (`instruction_text`, `match_instruction`)

Not:
- Dosya adi (`file_name`) fingerprint icinden cikarilmistir.
- Bu sayede ayni format farkli dosya adlariyla gelse de ayni profile eslesebilir.

#### B) Akis: talimat ver -> secimleri kaydet -> onay

1. Kullanici chatten talimat verir (ornek: "gorselde 8 olcu var, APL ile baslayanlari one al").
2. Sistem bu talimatla extraction + matching'i tekrar calistirir.
3. Kullanici tabloda dogru stoklari manuel duzeltir ve `Secimleri Kaydet` yapar.
4. Kayit basariliysa:
   - `/feedback` ile satir-bazli dogru secimler yazilir.
   - `/profiles/confirm` ile extraction profiline onayli geri bildirim yazilir.
5. Bu onaylar sonraki benzer belgelerde profile guven skorunu arttirir.

#### C) "Gorselde 8 olcu var" gibi kurallar nasil kullanilir

Image extraction asamasinda sistem su kontrolleri yapar:

- OCR + parser sonucu cikar.
- `candidate_line_count` ile gorselden tahmini satir sayisi hesaplar.
- Talimatta "8 satir/olcu/kalem" gibi bir beklenti varsa (`expected_item_count`) bunu parser sonucuyla karsilastirir.
- Parser sonucu beklenen sayidan dusukse LLM fallback zorlanir (text/image fallback).

Bu sayede:
- "8 olcu var" talimati sadece not olarak kalmaz.
- Gercek fallback kararini etkileyen bir kural haline gelir.

#### D) Basari nasil olculur

Extraction basarisi:
- Beklenen satir adedi ile bulunan satir adedi uyumu
- Satirlarin olcu + adet olarak parse edilmesi

Matching basarisi:
- Kullanici secimi ile top adaylarin ortusmesi
- `/feedback` kayitlarinda duzeltme oraninin zamanla dusmesi

Profil basarisi:
- `extraction_profiles.use_count` ve `success_count` artis trendi
- Benzer girdilerde otomatik profile uygulandiginda hata oraninin azalmasi

#### E) Ogrenmeyi bozan anti-patternler

- Dosya adini ogrenme anahtari yapmak (artik yok)
- Tek seferlik dosya formatina asiri overfit talimat vermek
- `Secimleri Kaydet` yapmadan profile onay beklemek

#### F) Operasyonel onerilen kullanim

1. Chatte extraction beklentisini net yazin:
   - "Bu gorselde 8 olcu olmali."
   - "Olcu satiri formati: XxYxZ - N Ad."
2. Eslestirme kuralini ayri yazin:
   - "APL 7075 stoklarini one al."
3. Son tabloda dogru stoklari secip `Secimleri Kaydet` ile onaylayin.
4. 2-3 benzer belge sonrasi kaliteyi tekrar olcun.

### 5. Siparis Gonderim Kuyrugu

- `/orders/confirm-send` secilen satiri `outbound_order_queue` tablosuna yazar.
- `/offers/save-draft` teklif basligini ve satir duzeltmelerini taslak olarak kaydeder.
- `/offers/send` secilen satirlari ERP teklif payload'i olarak kuyruga yazar.
- Endpoint tanimliysa ilk gonderim denenir.
- Basarisiz/pending kayitlari `order-dispatcher` periyodik olarak tekrar dener.
- Retry kolonlari: `attempt_count`, `next_retry_at`, `last_attempt_at`.

Kod:
- `apps/order-dispatcher/src/index.ts`
- `packages/db/migrations/005_outbound_order_retry.sql`

## Veritabani Semasi (Ozet)

- `stock_master`
- `stock_features`
- `match_history`
- `sync_checkpoint`
- `outbound_order_queue`
- `extraction_profiles`
- `extraction_profile_examples`
- `extraction_feedback`

Migrationlar:
- `packages/db/migrations/001_init.sql`
- `packages/db/migrations/002_outbound_order_queue.sql`
- `packages/db/migrations/003_category3.sql`
- `packages/db/migrations/004_extraction_profiles.sql`
- `packages/db/migrations/005_outbound_order_retry.sql`
- `packages/db/migrations/006_offer_drafts.sql`

## API

- `GET /health`
- `GET /stocks`
- `POST /extract-source`
- `POST /profiles/save`
- `POST /profiles/confirm`
- `POST /match`
- `POST /feedback`
- `POST /orders/confirm-send`
- `POST /offers/save-draft`
- `POST /offers/send`
- `GET /ml/status`

UI: `http://localhost:8080/ui/`

## Kurulum ve Calistirma

1. Ornek env'i kopyalayin:

```powershell
Copy-Item .env.example .env
Copy-Item .env.local.example .env.local
```

2. ERP ve DB ayarlarini `.env` icinde doldurun.
3. Secretlari (`OPENAI_API_KEY`, `GOOGLE_VISION_API_KEY`, `ERP_ORDER_API_KEY`, `ERP_OFFER_API_KEY`) sadece `.env.local` icine yazin.
4. Calistirin:

```powershell
docker compose up --build
```

## Uzak Windows Sunucuda Yayinlama

Bu repo uzak Windows sunucuda Docker Desktop ile yayinlanabilir. Local gelistirme akisi degismez; sunucu icin ayri `.env` degerleri kullanin.

Onemli:

- Sunucudaki PostgreSQL host makinede calisiyorsa container icinden `localhost` degil `host.docker.internal` kullanin.
- Bu nedenle sunucuda `ERP_PG_HOST=host.docker.internal` olmalidir.
- Uygulamanin kendi PostgreSQL'i compose icindeki `matching_db` servisi olarak calisir; bu nedenle `MATCH_PG_HOST=matching_db` ve `MATCH_PG_PORT=5432` kullanin.
- Domain yoksa dogrudan IP uzerinden HTTP (`80`) ile yayinlayin. IP uzerinden guvenilir `443` icin ayri sertifika yonetimi gerekir.

Hazir dosyalar:

- `docker-compose.prod.yml`
- `deploy/nginx/default.conf`
- `deploy/.env.server.example`
- `deploy/.env.local.server.example`
- `deploy/publish-server.ps1`

Sunucuda ozet kurulum:

```powershell
git clone <repo-url> C:\stock-matching-platform
cd C:\stock-matching-platform
powershell -ExecutionPolicy Bypass -File .\deploy\publish-server.ps1
```

Script ilk calistirmada `.env` ve `.env.local` dosyalarini orneklerden olusturur ve durur. ERP baglanti bilgileri ayni kalacaksa genelde sadece `MATCH_PG_*` alanlarini degistirmeniz yeterlidir. Sonra ayni komutu tekrar calistirin.

Varsayilan davranis:

- mevcut containerlari kapatir
- PostgreSQL volume'unu siler
- sifirdan veritabani olusturur
- migrationlari uygular
- uygulamada sadece `admin` kullanicisini birakir

Bu ilk kurulum ve tam reset icindir. Veritabani korunacak normal guncelleme icin:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\publish-server.ps1 -ResetDatabase:$false -EnforceAdminOnly:$false
```

Manuel komut:

```powershell
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Kontrol:

```powershell
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f matching-api
Invoke-RestMethod -Uri "http://localhost/health" -Method Get
```

Erisim:

- API: `http://SUNUCU_IP/`
- UI: `http://SUNUCU_IP/ui/`
- ilk giris: `admin / admin`

## Deploy Paketi

Tum repo yerine sadece yayin icin gereken dosyalari tasimak isterseniz deploy paketi kullanin.

Paket olusturma:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\create-deploy-package.ps1
```

Olusan ciktilar:

- `out/stock-matching-platform-deploy/`
- `out/stock-matching-platform-deploy.zip`

Bu paket sunlari icerir:

- build edilmis `dist` klasorleri
- runtime Dockerfile (`Dockerfile.runtime`)
- package compose dosyasi (`docker-compose.package.yml`)
- migration SQL dosyalari
- OCR servis dosyalari
- deploy env ornekleri ve yayin scripti

Sunucuda ZIP'i acip paket klasoru icinde su komutlari calistirin:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\publish-package.ps1
```

Bu script de varsayilan olarak volume'u sifirlar, migration calistirir ve sadece `admin` kullanicisini birakir. ERP degerleri ayni ise paket icinde de genelde sadece `MATCH_PG_*` alanlarini guncellemeniz yeterlidir.

## Debug

- API: `npm run debug:api`
- Sync: `npm run debug:sync`
- Dispatcher: `npm run debug:dispatch`
- Hepsi icin: `./start-debug.ps1 -Service all`

## Operasyonel Notlar

- Migration artik tek servis (`migrate`) tarafindan kosulur.
- Migration scripti advisory lock kullanir; paralel migration denemeleri serialize edilir.
- OCR servisinin ilk acilisinda Paddle model indirme nedeniyle gecikme olabilir.
- Harici ERP endpoint bos ise siparisler kuyrukta kalir (`pending`) ve endpoint tanimlandiginda dispatcher tarafindan islenir.

