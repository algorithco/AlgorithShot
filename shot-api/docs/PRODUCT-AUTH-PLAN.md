# AlgorithShot: majburiy login va Account integratsiyasi rejasi

Sana: 2026-10-29. Holat: Shot API implementatsiya qilingan; markaziy Account sozlash va native desktop integratsiyasi keyingi tashqi bosqich. Amaldagi yo‘riqnomalar: [Account setup](ACCOUNT-SETUP.md), [native integratsiya](NATIVE-INTEGRATION.md), [operations](OPERATIONS.md).

Ushbu ish doirasida faqat `shot-api/` ichidagi fayllar o‘zgartiriladi. Desktop, company web va markaziy Account servisiga tegishli ishlar quyida tashqi integratsiya talablari sifatida ko‘rsatilgan. Kompaniya repolari clone qilinmadi: manbalar authenticated GitHub API orqali o‘qildi. Production servisining ishlashi yoki konfiguratsiyasi shu tekshiruv bilan tasdiqlanmagan.

## 1. Kelishilgan product talablari

- Foydalanuvchi web orqali Algorithco Account ochadi yoki mavjud account bilan kiradi.
- Rasmiy AlgorithShot ilovasidan foydalanishdan oldin login majburiy.
- Birinchi product versiyada foydalanish bepul. Pullik tarif, checkout va subscription sotib olish bu bosqichga kirmaydi.
- Muvaffaqiyatli logindan keyin cheklangan muddat offline foydalanish mumkin. Birinchi login internet bilan bajariladi.
- App ichida Account bo‘limi bo‘ladi: profil, tasdiqlangan email holati, Free ruxsat, shu kompyuterdagi login holati, offline muddati, logout va markaziy account boshqaruvi.
- Skrinshotlar, OCR matnlari va mahalliy kutubxona hisob ochish sababli serverga yuborilmaydi. Rasm upload va cloud sync uchun alohida product talabi kerak.

Shot API konfiguratsiyasidagi boshlang‘ich maksimum 7 kun, yangilash tavsiyasi 24 soat; bu qiymatlar environment orqali o‘zgartiriladi va markaziy Shot policy bilan moslashtiriladi. OIDC token muddati, entitlement tekshiruvi va offline ruxsat muddati alohida tushunchalar.

## 2. GitHub orqali tekshirilgan tizim

Markaziy private repo: [algorithco/Algorithco](https://github.com/algorithco/Algorithco), tekshirilgan commit: `b5509493e0bfd91138c9c8389d87c97a42cf33af`.

Company web: [algorithco/AlgorithWeb](https://github.com/algorithco/AlgorithWeb), tekshirilgan snapshot: `0950d926e5d587ba7a7c6d91688dfd5e63c8a18b`.

Quyidagi versiyalar repository konfiguratsiyasida ko‘rsatilgan; ular production serverdagi o‘rnatilgan versiyalar haqidagi da’vo emas.

| Qism | Mavjud texnologiya / imkoniyat |
| --- | --- |
| Account runtime | Node 22.12–22.x, TypeScript 5.9.3, pnpm 10.29.3 |
| Account HTTP | Fastify 5.12.5, cookie/formbody/helmet/middie pluginlari |
| Identity provider | `oidc-provider` 9.12.2; OIDC Authorization Code + S256 PKCE |
| Token tekshirish | `jose` 6.2.8; ES256, discovery va JWKS |
| Markaziy ma’lumotlar | PostgreSQL, Prisma 6.19.3 va migrationlar; production Compose’da PostgreSQL 17.6 |
| Redis | `ioredis` 5.8.1; rate limit va qisqa social-login state; Compose’da Redis 8.2 |
| Parol | Argon2id, parol siyosati va breach-check imkoniyati |
| Web login | Email/parol, email tasdiqlash, email OTP oqimlari, Google va GitHub integratsiyasi |
| MFA | TOTP, recovery code, recent-auth va authentication assurance tekshiruvlari |
| Sessiyalar | Browser sessiyalar, native app grantlari, kompyuter nomi, revoke va audit |
| Refresh | Har ishlatilganda rotation; eski refresh token takror ishlatilsa grant bekor qilinadi |
| Muddatlar | Access va ID token 10 daqiqa; refresh 90 kun sliding, grant ko‘pi bilan 2 yil |
| Account | Profil, parol, MFA, ulangan identity, sessiyalar, app ruxsatlari, account deletion |
| Tashkilotlar | Org, owner/member va seat modellari |
| Product ruxsatlari | Product/Plan/Entitlement, Free default, manual grant va billing asosidagi ruxsatlar |
| Billing | `fake`, `manual`, `stripe` provider interfeysi; Shot Free uchun checkout kerak emas |
| Offline | Alohida ES256 license JWT va alohida license JWKS; device ID maydoni |
| Xabarnomalar | Nodemailer/SMTP va Resend adapterlari; console faqat local/test uchun |
| Webhook | HMAC imzo, timestamp, retry va delivery yozuvlari; amaldagi event `entitlement.changed` |
| Infra va sifat | Docker Compose, Caddy, migration, health/readiness, audit, Biome, Vitest, GitHub Actions |
| Company web | Next.js 16, React 19, TypeScript, TanStack Query, Tailwind 4 |
| Shot API | Node 24.13+, TypeScript 6, Fastify 5, JOSE auth, Account/entitlement/license API, Redis limits va Swagger/OpenAPI; alohida identity DB yo‘q |

Markaziy servis foydalanuvchi, credential, account session, OIDC grant, entitlement va license uchun asosiy manba bo‘ladi. Shot API ushbu ma’lumotlarning alohida identity nusxasini yuritmaydi.

### Koddan aniqlangan integratsiya bo‘shliqlari

1. `shot-desktop` client mavjud emas. Boshqa product client ID’sini Shot nomidan ishlatish to‘g‘ri bo‘lmaydi.
2. `shot:access` scope mavjud emas. Global scope ro‘yxati va `resourceServerScopes()` birgalikda yangilanishi kerak.
3. Plan katalogidagi product validatsiyasi `voice | guard` va aniq ikkita product bilan cheklangan. `shot` product, Free plan, seed va tegishli testlar qo‘shilishi kerak.
4. `ACCOUNT_API_CLIENT_IDS` default qiymati faqat company web client’iga ruxsat beradi. Shot client’iga entitlement/license endpointlari uchun alohida ruxsat kerak.
5. `license:issue` global OIDC scope sifatida bor, lekin tekshirilgan `resourceServerScopes()` qaytaradigan scope’lar ichida yo‘q. Uni faqat kerakli client va product uchun ochish kerak.
6. `planCatalog.policy.licenseTtlDays = null`. App license signer’ni faqat key va TTL mavjud bo‘lganda yaratadi; shuning uchun offline license oqimi hozir tayyor deb hisoblanmaydi.
7. License TTL hozir umumiy siyosat. Shot uchun 7 kunni yoqish Voice/Guard siyosatini bilmasdan o‘zgartirmasligi kerak; product bo‘yicha TTL qo‘llash talab qilinadi.
8. To‘liq Account overview va account mutation endpointlari browser cookie, CSRF va ayrim holatlarda recent-auth/MFA talab qiladi. Oddiy desktop Bearer token ular bilan avtomatik ishlamaydi.
9. `docs/INTEGRATION.md` ichidagi pairing-code yo‘riqnomasi amaldagi provider kodidan ortda qolgan: provider faqat `device_name` qo‘shimcha parametrini oladi, eski `pairing` parametri tashlanadi. Native Approve/Deny oqimi esa mavjud. Shot eski pairing oqimini implementatsiya qilmaydi.
10. Ayrim hujjatlardagi eski issuer misollari bilan amaldagi konfiguratsiya misoli farq qiladi. Tekshirilgan konfiguratsiyada `https://algorithco.trqsh.uz/account` ko‘rsatilgan; haqiqiy deployment qiymati sozlamadan olinib, discovery’dagi `issuer` bilan aniq tekshiriladi.
11. `@algorithco/auth-client` private workspace package, Node 22 engine chekloviga ega. Uni Shot Node 24 workspace’iga shunchaki import qilib bo‘lmaydi. Git dependency orqali clone qilish rejalashtirilmaydi.
12. Account README servisni pre-production deb belgilaydi. Koddagi imkoniyatlar production sozlamalari, kalitlari va monitoringi allaqachon tayyorligini anglatmaydi.

## 3. Mas’uliyat va maqsad arxitektura

```mermaid
sequenceDiagram
    participant D as AlgorithShot native app
    participant W as Tashqi browser / company web
    participant A as Algorithco Account
    participant S as Shot API
    D->>A: Ishonchli issuer discovery
    D->>W: Authorization Code + PKCE login
    W->>A: Signup/login, email verification, MFA va Approve
    A-->>D: Loopback callback: code + state
    D->>A: Code + verifier; client secret yo‘q
    A-->>D: Access / ID / rotated refresh tokenlar
    D->>S: Bearer access token bilan Account va access so‘rovi
    S->>S: Imzo, issuer, audience, client va scope tekshirish
    S->>A: Shot entitlement / license kontrakti
    A-->>S: Free ruxsat va imzolangan offline license
    S-->>D: Tekshirilgan ruxsat va license
    D->>D: Native ruxsat tekshiruvi va mahalliy ishlash
```

| Kim | Vazifa |
| --- | --- |
| Algorithco Account | Signup/login, credential, email verification, MFA, refresh/grant, account boshqaruvi, Shot entitlement va license imzolash |
| Company web | Mavjud `/signin`, signup holati, email verification, Account center; login transaction’ni saqlab app’ga qaytish |
| `shot-api` — ushbu ish scope’i | Token tekshirish, product authorization, Account o‘qish kontrakti, entitlement/license adapteri, API hujjati, xavfsizlik va production tayyorgarligi |
| Desktop — tashqi integratsiya talabi | Browser login, loopback callback, OS secure storage, Account UI va barcha kerakli native amallarda ruxsat tekshiruvi |

Faqat Shot API’ga auth qo‘shish bilan lokal screenshot funksiyasi login talab qiladigan bo‘lib qolmaydi. Hotkey, tray, CLI va Rust command yo‘llari ham app tomonidan himoyalanishi shart. Shu native integratsiya bajarilmaguncha product talabi to‘liq bajarilgan hisoblanmaydi.

## 4. Login va token kontrakti

Quyidagi yangi identifikatorlar reja taklifi; ular hali markaziy servisga qo‘shilmagan:

| Parametr | Rejalashtirilgan qiymat |
| --- | --- |
| Product | `shot` |
| Native client | `shot-desktop`, `application_type=native`, public client |
| Client authentication | `token_endpoint_auth_method=none` |
| Oqim | `authorization_code`, S256 PKCE, rotated `refresh_token` |
| Callback | `http://127.0.0.1:<ephemeral-port>/callback`; aniq loopback host/path |
| Resource | Mavjud company arxitekturasiga mos `urn:algorithco:platform-api` |
| Access token audience | `algorithco-platform-api` |
| ID token audience | `shot-desktop` |
| Scopes | `openid profile email offline_access shot:access entitlements:read license:issue` |

Shared audience sabab faqat `aud` tekshiruvi yetmaydi: Shot API har safar `client_id=shot-desktop` allowlist’ini va kerakli `shot:access` scope’ini ham tekshiradi. Voice/Guard yoki company web tokeni tasodifan Shot ruxsatiga aylanmaydi. Kelajakda web client kerak bo‘lsa, u alohida ruxsat va test bilan qo‘shiladi.

Login ketma-ketligi:

1. App ishonchli issuer’ning discovery hujjatini oladi va issuer qiymatini aniq solishtiradi. Endpoint manzillari token ichidan yoki foydalanuvchi yuborgan URL’dan olinmaydi.
2. Native qism kriptografik random `state`, `nonce`, PKCE verifier yaratadi; vaqtinchalik loopback listener ochadi va tashqi browser’ni ishga tushiradi.
3. OIDC authorization request `response_type=code`, S256 challenge, resource, scopes, `prompt=consent` va ixtiyoriy sanitizatsiya qilingan `device_name` bilan yuboriladi. `offline_access` grant olishi uchun consent parametri kerak.
4. Browser’da mavjud company signup/login ishlatiladi. Email tasdiqlanmagan, bloklangan yoki deletion so‘ralgan user uchun app tokeni chiqarilmaydi. MFA yoqilgan bo‘lsa, markaziy oqim uni bajaradi.
5. Native app uchun browser’da Approve/Deny ko‘rsatiladi. Signup yoki password recovery’dan so‘ng aynan shu login transaction’ga qaytish staging testida tekshiriladi.
6. Callback’da `state`, path va bir martalik transaction tekshiriladi; code original verifier bilan token endpoint’da almashtiriladi. Listener muvaffaqiyat, bekor qilish yoki timeout’da yopiladi.
7. ID token uchun signature/issuer/audience/nonce/expiry; API access token uchun uning alohida kontrakti tekshiriladi. ID token API Bearer tokeni sifatida ishlatilmaydi.
8. Refresh token faqat OS credential vault’da saqlanadi. Refresh bir vaqtda bitta bajariladi; yangisi atomik saqlanib eskisi tashlanadi. `invalid_grant` qayta login holatiga olib keladi.

Bu oqim tashqi browser va native callback uchun [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252), refresh xavfsizligi uchun [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700), access-token turi uchun [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) bilan moslashtiriladi.

Shot API verifier’i `ES256`, `kid`, `typ=at+jwt`, `iss`, `aud`, `sub`, `iat`, `exp`, `client_id`, `scope` va kerakli claim turlarini tekshiradi. `email_verified=true` talab qilinadi. Foydalanuvchi identifikatori `issuer + sub`; email faqat profil/contact ma’lumoti. ID-token markerlari, noto‘g‘ri client/scope, tampered yoki muddati o‘tgan tokenlar rad etiladi. Unknown `kid` uchun cheklangan JWKS refresh bo‘ladi; tekshirish ishlamasa oddiy decode’ga o‘tilmaydi.

Verifier uchun tavsiya: Shot API’da mos `jose` versiyasi orqali protokol kontraktini implementatsiya qilish. Markaziy private paket keyinchalik Node 24 qo‘llaydigan ruxsatli artifact sifatida chiqarilsa, undan foydalanish qayta baholanadi. Private servis kodi public Shot reposiga ko‘chirilmaydi.

## 5. App Account bo‘limi va offline foydalanish

Account ekrani uchun backend beradigan ma’lumotlar:

- Barqaror user ID, ism, email, tasdiqlangan email holati; ma’lumotning token olingan vaqtdagi snapshot ekani.
- Product: AlgorithShot, plan: Free, account talab qilinishi va ruxsat etilgan imkoniyatlar.
- Shu app login’ining holati va, token bergan bo‘lsa, `grant_id`. Bu umumiy web sessiyasi bilan bir xil emas.
- Offline ruxsatning tugash vaqti, oxirgi online tekshiruv va yangilash holati.
- Markaziy Account center’ga ishonchli URL; logout va qayta login bo‘yicha app kontrakti.

Profil tahrirlash, parol almashtirish, MFA, social identity, barcha browser sessiyalari, connected apps va account deletion mavjud company web’da boshqariladi. App bu amallarni tashqi browser’da ochadi. Browser cookie’si Tauri WebView yoki Shot API orqali ko‘chirib yurilmaydi.

Ushbu amallarni to‘liq app ichida bajarish kerak bo‘lsa, markaziy servisda desktop uchun Bearer + scope + recent-auth/step-up kontrakti alohida qo‘shilishi kerak. Hozir mavjud cookie-only Account API’sini tayyor desktop API deb taqdim etish mumkin emas.

Offline tartib:

1. Account va Shot entitlement tekshirilgandan keyin markaziy servis Shot uchun license JWT imzolaydi. Shot API license’ni o‘zi imzolamaydi va markaziy private key’ni olmaydi.
2. License uchun alohida public JWKS ishlatiladi; OIDC JWKS bilan almashtirilmaydi. Kutiladigan maydonlar: `iss`, `aud`, `sub`, `iat`, `exp`, `jti`, `product=shot`, `plan=free`, `limits`, `device_id` va ES256 `kid`.
3. Shot so‘rovida installation ID majburiy qilinadi. U random lokal ID bo‘ladi; qurilmaning apparat fingerprint’i talab qilinmaydi. Markaziy license’dagi `device_id` asl yuborilgan ID bo‘ladi; DB’dagi `deviceHash` bilan aralashtirilmaydi.
4. App native qismida signature, trusted key, issuer, license audience, subject, product, plan, device ID va muddat tekshiriladi. UI’dagi `loggedIn=true` yoki cache’dagi JSON ruxsat manbasi bo‘la olmaydi.
5. Internet yo‘q bo‘lsa, oldin olingan va hali valid bo‘lgan license bilan ishlash davom etadi. Tarmoq xatosi bor license’ni bekor qilmaydi va muddatini ham uzaytirmaydi.
6. Birinchi login bajarilmagan yoki license tugagan bo‘lsa, yangi himoyalangan amallar qayta login/tekshiruvgacha yopiladi. Skrinshot fayllari va mavjud ishlar o‘chirilmaydi.
7. Logout’da lokal token/license va joriy session cache tozalanadi. Online bo‘lsa, native refresh token discovered revocation endpoint orqali bekor qilinadi. Browser’dagi boshqa product sessiyalarini tugatish alohida foydalanuvchi amali bo‘ladi.
8. Refresh revoke, blocked/deleting account va boshqa aniq auth rad javobi tarmoq uzilishi deb talqin qilinmaydi. App qayta kirish holatiga o‘tadi va yangi offline ruxsat olmaydi.
9. Cached license offline paytda darhol masofadan revoke qilinmaydi; uning `exp` muddati ushbu oynani chegaralaydi. Online grant revocation’dan keyin allaqachon chiqarilgan access JWT ham 10 daqiqagacha valid bo‘lishi mumkin. Agar license renewal uchun darhol revoke talabi qo‘yilsa, markaziy servis `grant_id` bo‘yicha active-grant tekshiruvini ham bajarishi kerak.
10. Native qism oxirgi ishonchli server vaqtini eslab clock rollback’ni aniqlaydi. OS vault va lokal clock tekshiruvi to‘liq buzilgan qurilmaga qarshi mutlaq himoya sifatida ko‘rsatilmaydi.

Taklif etilgan app holatlari: `signed_out`, `signing_in`, `signed_in_online`, `signed_in_offline`, `reauth_required`. Hotkey/tray/CLI va capture/OCR/edit native commandlari bitta ruxsat siyosatidan foydalanadi. Bu desktop ishlarining vazifasidir.

## 6. `shot-api` uchun rejalashtirilgan HTTP kontrakt

Quyidagi endpointlar Shot API’da implementatsiya qilingan. Swagger/OpenAPI development’da mavjud; production’da default bo‘yicha yopiq.

| Endpoint | Himoya | Vazifa |
| --- | --- | --- |
| `GET /health` | Public | Jarayonning liveness holati; dependency xatosi sabab liveness false bo‘lmaydi |
| `GET /ready` | Infra policy | Startup konfiguratsiyasi va zarur dependency/cache holati; har chaqiruvda Account’ga og‘ir so‘rov qilinmaydi |
| `GET /api/v1/auth/config` | Public, rate limit | Ishonchli issuer/client/resource/scopes va account URL; secret/token yo‘q |
| `GET /api/v1/me` | Bearer + `shot:access` | Tekshirilgan profil snapshot’i va app Account ekrani uchun linklar |
| `GET /api/v1/me/access` | Bearer + `shot:access` + `entitlements:read` | Shot entitlement, Free imkoniyatlar, policy version va online tekshiruv holati |
| `GET /api/v1/me/entitlements` | Bearer + `shot:access` + `entitlements:read` | Faqat joriy user va `shot` product’ining normalizatsiya qilingan ruxsati |
| `POST /api/v1/me/offline-license` | Bearer + `shot:access` + `entitlements:read` + `license:issue` | Live entitlement, device ID, markaziy license va imzo tekshiruvi |

Shot API account, product, plan yoki user ID’ni so‘rov body’sidan ishonchli deb olmaydi: user `sub`dan, product `shot` konstantasidan olinadi. License proxy faqat kutilgan markaziy endpointga murojaat qiladi; caller URL, cookie, token header yoki boshqa product qiymatini uzatib bera olmaydi.

Markaziy `license:issue` ham client qaysi product’ga license so‘rashi mumkinligini tekshirishi kerak. Shot API’dagi `product=shot` cheklovi yolg‘iz yetarli emas: native user tokeni bilan markaziy endpointga to‘g‘ridan-to‘g‘ri murojaat qilish ham mumkin.

Profil mutation va logout uchun ishlamaydigan proxy endpointlar qo‘shilmaydi. Joriy native logout OIDC revocation bilan bajariladi; barcha sessiyalarni ko‘rish/tugatish markaziy Account center’da qoladi. App API holatlarini alohida qabul qilishi uchun `401` invalid/expired auth, `403` scope/product rad, `429` limit, `503` upstream/policy unavailable va umumiy request ID kontrakti hujjatlashtiriladi. Response’lar token yoki shaxsiy ma’lumot bilan shared cache’ga tushmaydi.

Markaziy servisning tekshirilgan path xaritasi:

| Manba / endpoint | Haqiqiy joylashuv va qo‘llanishi |
| --- | --- |
| OIDC discovery | `{issuer}/.well-known/openid-configuration`; issuer misolida `/account` prefiksi bor |
| OIDC authorize/token/revoke/JWKS | Aniq URL’lar discovery’dan olinadi |
| Entitlement | Account host’ining root qismida `GET /v1/entitlements?product=shot` |
| Offline license | O‘sha root’da `POST /v1/licenses`, public keys `/v1/licenses/jwks.json` |
| Browser Account overview | `/account/api/account/overview`; cookie/CSRF kontrakti, desktop Bearer API emas |
| Company login / Account UI | Web’da `/signin`, signup uchun `/signin?mode=signup`, boshqaruv `/app/account` |

Billing/license URL’larini issuer oxiriga ko‘r-ko‘rona qo‘shish `/account/v1/...` degan noto‘g‘ri manzil hosil qiladi. `ACCOUNT_ISSUER`, `ACCOUNT_API_BASE_URL`, `ACCOUNT_WEB_URL`, `ACCOUNT_AUDIENCE`, `ACCOUNT_CLIENT_IDS`, `LICENSE_AUDIENCE` va timeout/cache parametrlari implementatsiya hamda `.env.example`da mavjud. `shot:access` esa o‘chirib qo‘yiladigan env flag emas, majburiy kod kontrakti. URL’lar trusted origin bilan tekshiriladi; public `/auth/config` javobi app’ning oldindan ishonilgan issuer’ini almashtirish huquqini bermaydi.

## 7. Saqlash, xavfsizlik va production tayyorgarligi

Bu release uchun Shot API asosan stateless resource server va markaziy entitlement/license adapteri bo‘ladi. Markaziy PostgreSQL’ga to‘g‘ridan-to‘g‘ri ulanmaydi; o‘z `users/passwords/sessions` bazasini yaratmaydi. HTTP orqali integratsiya Account Node 22 va Shot Node 24 runtime’larini mustaqil saqlaydi.

Redis bir nechta API instance uchun rate limit va qisqa cache kerak bo‘lganda qo‘shiladi. Cache key’lari issuer, subject va product bo‘yicha ajratiladi. Birinchi offline ruxsatni eskirgan cache yoki upstream xatosidan yaratish mumkin emas; yangi license markaziy servisning muvaffaqiyatli javobini talab qiladi.

Mahsulotga xos saqlanadigan cloud preferences, device registry yoki webhook inbox talabi paydo bo‘lsa, Shot uchun alohida schema/migration rejalashtiriladi. Bular ushbu login/account talabiga yashirincha qo‘shilmaydi. Webhook yoqilsa, raw-body HMAC, timestamp, durable dedup va qayta ishlashsiz muvaffaqiyat qaytarmaslik shart; billing webhook’ni account-blocked/deleted eventi deb qabul qilish mumkin emas.

Production ishlar ro‘yxati:

- Fail-fast config: HTTPS issuer, aniq expected audience/client, ishonchli endpoint origin’lari, timeout va body/response hajmi chegaralari.
- OIDC va license kalitlari alohida; API faqat public key oladi. JWKS cache chegaralangan; rotation uchun key overlap va unknown-kid testlari.
- Header security, aniq origin CORS; credentials/wildcard’ni avtomatik ochmaslik. CORS authentication o‘rnini bosmaydi.
- IP va tekshirilgan user asosida rate limit; caller yuborgan proxy header’iga ishonmaslik. Trusted proxy hop soni deploymentga mos beriladi.
- Token, refresh, authorization code, cookie, license JWT va shaxsiy ma’lumotlar log/trace/error’dan redact qilinadi.
- Account upstream so‘rovlari timeout va bounded retry bilan; license POST idempotency/duplicate issuance xatti-harakati alohida belgilanadi.
- Swagger’da Bearer security scheme, barcha error response’lar va aniq schema; production hujjatlarining ochiqligi deployment konfiguratsiyasi bilan belgilanadi.
- Container non-root, graceful shutdown, health/readiness, log yig‘ish, monitoring va rollback runbook’i `shot-api/` ichida.
- Shot API host, company issuer, account center URL, DNS/TLS va secret delivery production environment’dan beriladi; misol domen avtomatik production qiymati deb olinmaydi.

## 8. Bajarish bosqichlari va qabul mezonlari

| Bosqich | Ushbu scope’da bajariladigan ish | Qabul mezoni |
| --- | --- | --- |
| 1. Kontrakt | Ushbu reja, OpenAPI draft, env nomlari, Account adapter interfeysi, auth/error test ssenariylari | Haqiqiy company token/claim shakliga mos kontrakt; ishlab turgan va hali kerak bo‘lgan endpointlar ajratilgan |
| 2. Auth middleware | Config, discovery/JWKS, ES256 verifier, user context, route protection va rate limit | Soxta, ID, expired, noto‘g‘ri issuer/audience/client/scope tokenlari rad etiladi; valid Shot tokeni qabul qilinadi |
| 3. Account API | `/auth/config`, `/me`, profile snapshot va ishonchli account linklari | App Account ekrani uchun yetarli typed javob; signup/parol/MFA Shot’da takror yaratilmagan |
| 4. Ruxsat va offline | Shot entitlement adapteri, `/me/access`, `/me/entitlements`, license proxy va response verification | Account’siz yoki boshqa product bilan offline ruxsat olish mumkin emas; upstream xatosi yangi ruxsat yaratmaydi |
| 5. Production | Log redaction, monitoring, timeout, readiness, container va release/runbook | Multi-instance, upstream outage, JWKS rotation va rollback ssenariylari tekshirilgan |
| 6. End-to-end qabul | `shot-api` ichida integration kontrakt testlari va staging tekshiruv yo‘riqnomasi | Tashqi Account/web/desktop dependency’lari bilan yangi user signup’dan native offline expiry’gacha oqim o‘tadi |

Rejalashtirilgan fayl tuzilishi, faqat `shot-api/` ichida:

```text
src/
  auth/        config/discovery, token verifier, require-user, claims
  account/     central Account client, response contracts, account links
  access/      Shot entitlements, access policy, license verification
  routes/      auth-config, me, access, entitlements, offline-license
  plugins/     rate limit, headers, errors, request IDs
test/          unit va HTTP kontrakt testlari
docs/          integration, native requirements, deployment va rollout
infra/         Shot API container/deployment namunalari
```

Implementatsiya fayllari `shot-api/` ichida. Foydalanuvchi ruxsati bilan AlgorithShot root `pnpm-lock.yaml` faqat Shot API dependency’lari uchun sinxron yangilandi; desktop va GitHub’dagi markaziy Account kodi bu ishda o‘zgartirilmadi.

### Tashqi integratsiya talablari — bu ishda tahrirlanmaydi

**Account servisi:** native `shot-desktop` client va redirect config; Shot scope/allowlist; `shot` Free product va seed; product bo‘yicha license TTL; license signing key/config; client-product license cheklovi; grant revocation kontrakti; tegishli test va deployment sozlamalari.

**Company web:** signup/login’dan native authorization transaction’iga qaytish; generic Account center’da Shot nomi va connected-app grant’i ko‘rinishi. `/app/shot` kabi alohida dashboard ushbu talab uchun majburiy emas, keyin alohida rejalashtiriladi.

**Desktop:** OS vault, native loopback PKCE, refresh rotation, Account ekrani, native license tekshiruvi, barcha capture entry point’laridagi ruxsat, offline expiry va logout. Faqat React routing’ni yopish bilan tugatilmaydi.

Mavjud o‘rnatmalardan o‘tish ham desktop dependency’si: upgrade rasmlar, original fayllar, indeks va foydalanuvchi sozlamalarini saqlaydi; keyingi foydalanish uchun Account login ekrani ochiladi. Account almashtirilganda oldingi user’ning auth/license cache’i yangi user’ga ishlatilmaydi. Lokal kutubxona serverdagi account mulki deb avtomatik belgilanmaydi yoki upload qilinmaydi. Lokal kutubxonani accountlar bo‘yicha ajratish alohida talab sifatida hal qilinadi.

Desktop va company web’dagi product tavsifi ham yangilanishi kerak: account/periodik online tekshiruv talab qilinadi, skrinshotlarning o‘zi lokal qoladi. Eski “accountsiz, butunlay offline” va’dasi yangi login siyosati bilan bir xil release’da tuzatiladi; bu hujjatlar ushbu backend scope’ida tahrirlanmaydi.

## 9. Test va rollout rejasi

- Unit/HTTP: valid Shot token; ID-token confusion; yo‘q/noto‘g‘ri claim, issuer, audience, client, scope, alg va kid; expiry va clock tolerance.
- Ruxsat: boshqa user ID’sini yuborish; Voice/Guard product injection; tasdiqlanmagan email; blocked/deleting account; entitlement yo‘qligi va upstream outage.
- Offline: license tampering; boshqa sub/product/device/audience; noto‘g‘ri key; expired/future timestamps; key rotation; clock rollback; birinchi login offline; muddat tugashidagi holat.
- Markaziy OIDC bilan staging: yangi signup + verification, mavjud account, Google/GitHub konfiguratsiya qilingan bo‘lsa, MFA, Approve/Deny, bekor qilingan callback, refresh reuse va native grant revoke.
- Account: o‘zgargan ism/email token yangilanganda aks etishi; logout/token cache tozalanishi; web Account center’da aynan Shot app’ini revoke qilish.
- Production: CORS, trusted proxy, rate limit, redacted logs, timeout, health/readiness, bir nechta instance va rollback.
- Desktop jamoasi uchun qabul: hotkey/tray/CLI loginni chetlab o‘ta olmasligi; 7 kun taklifi tasdiqlangach offline boundary; upgrade va logout’da rasmlar saqlanishi.

Avval test fixture’lar va fake Account adapter bilan `shot-api` mustaqil ishlab chiqiladi. Keyin staging’da haqiqiy markaziy servis kontrakti bilan tekshiriladi. Native majburiy login faqat API va markaziy client/product konfiguratsiyasi tayyor bo‘lgandan keyin rasmiy app release’ida yoqiladi. Rollback loginni universal chetlab o‘tishga aylanmaydi; oldin berilgan offline ruxsat uning muddatigacha ishlaydi, yangi himoyalangan server amallari auth talab qiladi.

## 10. Implementatsiyadan oldin yakunlanadigan qarorlar

1. Offline ruxsatning aniq muddati va yangilash oralig‘i: hozirgi taklif 7 kun / 24 soat.
2. Production Shot API URL, canonical issuer va company Account URL; ularning staging variantlari.
3. Markaziy Account/web/desktop tashqi integratsiya ishlarining egasi va bajarilish ketma-ketligi. Ushbu chatning tahrir scope’i `shot-api/` bilan cheklangan.
4. Barcha Account amallarini native UI’da bajarish talab qilinadimi? Boshlang‘ich reja app’da Account summary va web’da to‘liq xavfsizlik boshqaruvini beradi; native mutation uchun hozir mavjud bo‘lmagan Bearer/step-up kontrakti kerak.
5. Dependency scope masalasi hal qilindi: foydalanuvchi AlgorithShot ichidagi zarur lockfile yangilanishiga ruxsat berdi.

## 11. Tekshirilgan manbalar

Company snapshot’iga bog‘langan asosiy dalillar:

- [Account README va status](https://github.com/algorithco/Algorithco/blob/b5509493e0bfd91138c9c8389d87c97a42cf33af/README.md)
- [Account dependencies](https://github.com/algorithco/Algorithco/blob/b5509493e0bfd91138c9c8389d87c97a42cf33af/apps/api/package.json)
- [Prisma modellari](https://github.com/algorithco/Algorithco/blob/b5509493e0bfd91138c9c8389d87c97a42cf33af/apps/api/prisma/schema.prisma)
- [Client registry va resource scope’lar](https://github.com/algorithco/Algorithco/blob/b5509493e0bfd91138c9c8389d87c97a42cf33af/apps/api/src/oidc/clients.ts)
- [Provider: scopes, resource, token TTL va claimlar](https://github.com/algorithco/Algorithco/blob/b5509493e0bfd91138c9c8389d87c97a42cf33af/apps/api/src/oidc/provider.ts)
- [Account route va browser sessiya talablari](https://github.com/algorithco/Algorithco/blob/b5509493e0bfd91138c9c8389d87c97a42cf33af/apps/api/src/http/routes.ts)
- [Entitlement va license HTTP kontraktlari](https://github.com/algorithco/Algorithco/blob/b5509493e0bfd91138c9c8389d87c97a42cf33af/apps/api/src/http/billing-routes.ts)
- [Free plan katalogi va belgilanmagan license TTL](https://github.com/algorithco/Algorithco/blob/b5509493e0bfd91138c9c8389d87c97a42cf33af/apps/api/src/billing/plans.config.ts)
- [License claimlari va alohida signer](https://github.com/algorithco/Algorithco/blob/b5509493e0bfd91138c9c8389d87c97a42cf33af/apps/api/src/billing/licenses.ts)
- [Signer yoqilish shartlari](https://github.com/algorithco/Algorithco/blob/b5509493e0bfd91138c9c8389d87c97a42cf33af/apps/api/src/app.ts)
- [Native grant registry](https://github.com/algorithco/Algorithco/blob/b5509493e0bfd91138c9c8389d87c97a42cf33af/apps/api/src/services/grants.ts)
- [Private auth-client kontrakti](https://github.com/algorithco/Algorithco/blob/b5509493e0bfd91138c9c8389d87c97a42cf33af/packages/auth-client/src/index.ts)
- [Product integratsiya hujjati — kod bilan farqlar yuqorida qayd etilgan](https://github.com/algorithco/Algorithco/blob/b5509493e0bfd91138c9c8389d87c97a42cf33af/docs/INTEGRATION.md)
- [Company web: login implementation](https://github.com/algorithco/AlgorithWeb/blob/0950d926e5d587ba7a7c6d91688dfd5e63c8a18b/src/lib/account-auth.ts)
- [Company web: texnologiyalar](https://github.com/algorithco/AlgorithWeb/blob/0950d926e5d587ba7a7c6d91688dfd5e63c8a18b/package.json)

Backend endpointlari implementatsiya qilingan. Markaziy Account va desktop qabul mezonlari bajarilgandan keyin majburiy login rasmiy app release’ida yoqiladi; bu backend ishi ularning amalda bajarilganini anglatmaydi.
