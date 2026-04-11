# Deploy Package

Bu paket, uzak sunucuya tum kaynak kodu yerine sadece yayin icin gereken dosyalari tasimak icindir.

## Paket Olusturma

Local makinede:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\create-deploy-package.ps1
```

Olusan dosyalar:

- `out/stock-matching-platform-deploy/`
- `out/stock-matching-platform-deploy.zip`

Paketin icinde sadece su gruplar bulunur:

- runtime Dockerfile
- package compose dosyasi
- build edilmis `dist` klasorleri
- migration SQL dosyalari
- OCR servisi dosyalari
- production env ornekleri
- Nginx config
- yayinlama scripti

Kaynak `.ts` dosyalari, `.git`, `node_modules`, local env dosyalari pakete dahil edilmez.

## Sunucuda Kurulum

ZIP dosyasini sunucuya kopyalayin ve acin. Sonra paket klasoru icinde:

```powershell
Copy-Item .\deploy\.env.server.example .\.env
Copy-Item .\deploy\.env.local.server.example .\.env.local
notepad .env
notepad .env.local
powershell -ExecutionPolicy Bypass -File .\deploy\publish-package.ps1
```

Manuel komut:

```powershell
docker compose -f docker-compose.package.yml up -d --build
```

Kontrol:

```powershell
docker compose -f docker-compose.package.yml ps
docker compose -f docker-compose.package.yml logs -f matching-api
Invoke-RestMethod -Uri "http://localhost/health" -Method Get
```

Erisim:

- `http://SUNUCU_IP/`
- `http://SUNUCU_IP/ui/`
