# Markaziy Algorithco Account: Shot integratsiyasi

Shot API tomoni implementatsiya qilingan. Ushbu yo‘riqnoma markaziy servisni keyin sozlaydigan mas’ul uchun. Markaziy repo bu ishda o‘zgartirilmagan. Asos: oldin GitHub’dan ko‘rilgan `b5509493e0bfd91138c9c8389d87c97a42cf33af` snapshot’i; yangi commitlarda fayllarni qayta tekshiring.

Machine-readable kontrakt: [`../integration/algorithco-shot.json`](../integration/algorithco-shot.json). Hozirgi Account servisi bu JSON’ni avtomatik import qilmaydi; u client, scope, Free product va offline siyosatni bir joyda beradi.

## 1. Public native client

`apps/api/src/oidc/clients.ts` ichida `shot-desktop` qo‘shiladi:

```json
{
  "client_id": "shot-desktop",
  "client_name": "AlgorithShot Desktop",
  "application_type": "native",
  "redirect_uris": ["http://127.0.0.1/callback"],
  "response_types": ["code"],
  "grant_types": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_method": "none",
  "id_token_signed_response_alg": "ES256"
}
```

Redirect ro‘yxati yangi env orqali berilsin, masalan `SHOT_DESKTOP_REDIRECT_URIS=http://127.0.0.1/callback`. Runtime’da app ephemeral port ishlatadi; native loopback matching shu portni ruxsat qilishi tekshiriladi. Wildcard, LAN callback va desktop client secret qo‘shilmaydi. Registry’dagi native approval qoidasi Shot’ga ham tatbiq qilinadi; grant device name bilan Account center’da ko‘rinadi.

## 2. Scope va resource

Provider global scopes’iga `shot:access` qo‘shing. `resourceServerScopes("shot-desktop")` quyidagilarni berishi kerak:

```text
profile email shot:access entitlements:read license:issue
```

App so‘raydigan to‘liq scopes:

```text
openid profile email offline_access shot:access entitlements:read license:issue
```

Resource `urn:algorithco:platform-api`, access token `aud=algorithco-platform-api`, `client_id=shot-desktop`, `typ=at+jwt`, `alg=ES256`. ID token audience’i `shot-desktop`. Access/ID token 600 soniya; refresh har ishlatilganda yangilanadi. Email verified claim’i `true` bo‘lishi talab qilinadi.

`ACCOUNT_API_CLIENT_IDS` qiymatiga `shot-desktop`ni qo‘shing; oldingi clientlarni olib tashlamang. Shot’ga `billing:write`, `voice:access`, `guard:access` berilmaydi.

`license:issue`ni ochish bilan birga markaziy `/v1/licenses` endpointi client-product bog‘lanishini tekshirishi shart: `shot-desktop` faqat `product=shot` uchun license oladi. Shot API buni o‘zida ham cheklaydi, lekin user native token bilan markaziy endpointga bevosita murojaat qilishi mumkin.

## 3. Shot Free product

`apps/api/src/billing/plans.config.ts` ichida `shot` / `AlgorithShot` qo‘shing. `defaultPlan=free`, bitta `free` plan, `interval=none`, `rank=0`, `purchasable=false`, narx va provider price ID `null`, limits `{}`.

Katalogning `z.enum(["voice", "guard"])` va aniq ikkita product cheklovini Shot’ni qabul qiladigan qilib yangilang. Seed orqali Product/Plan yozuvlari yaratilishini tekshiring. Har verified user uchun Shot Free entitlement hisoblanishi kerak; checkout yoki manual operator grant’i kundalik foydalanish uchun talab qilinmaydi.

`GET /v1/entitlements?product=shot` Bearer bilan quyidagi shaklni qaytarishi kerak:

```json
{
  "entitlements": [{
    "product": "shot", "plan": "free", "status": "active",
    "limits": {}, "validUntil": null,
    "owner": { "type": "user", "id": "<token-sub>" }
  }]
}
```

`validUntil` aynan camelCase. Bo‘sh to‘plam, boshqa owner/product yoki expired/revoked ruxsat Shot tomonidan foydalanish ruxsati deb qabul qilinmaydi. Bloklangan va deletion so‘ralgan account uchun operatsiyalar rad etiladi.

## 4. Offline license

Shot API default maksimumi 604800 soniya (7 kun); yangilash tavsiyasi 86400 soniya (24 soat). Kerak bo‘lsa ikkala tomonda mos ravishda sozlang. Shot uchun siyosatni yoqish Voice/Guard uchun hali tasdiqlanmagan umumiy TTL’ni o‘zgartirmasin; product bo‘yicha siyosat qo‘shilsin.

- Alohida ES256 license kalitlarini sozlang va production container’ga yetkazing. OIDC signing key qayta ishlatilmaydi.
- `LICENSE_AUDIENCE=algorithco-products`; private license key faqat Account’da qoladi.
- `POST /v1/licenses` Bearer va `{"product":"shot","device_id":"<uuid-v4>"}` qabul qiladi.
- License claimlari: `iss`, `aud`, `sub`, `iat`, `exp`, `jti`, `product=shot`, `plan=free`, `limits={}`, `device_id`.
- Header: `alg=ES256`, `typ=JWT`, public JWKS’da mavjud `kid`.
- Javob `{"license":"<signed-jwt>","expires_at":"<ISO-date>"}`; signed `exp` haqiqiy tugash vaqti.
- Public key endpoint: `GET /v1/licenses/jwks.json`, OIDC JWKS’dan mustaqil.

Shot yangi license’dan oldin live entitlement oladi va license javobini yana tekshiradi. License muddati entitlement validUntil’dan yoki Shot’dagi maksimumdan oshsa rad etiladi. License POST avtomatik retry qilinmaydi; network natijasi yo‘qolsa qayta so‘rov boshqa `jti` yaratishi mumkin.

Offline license masofadan shu zahoti revoke bo‘lmaydi: existing license `exp`gacha ishlashi mumkin. Allaqachon chiqarilgan access token ham 10 daqiqagacha valid. Grant revoke’dan keyin darhol yangi license berilishini to‘xtatish kerak bo‘lsa, markaziy issuance `grant_id`ning faol ekanini tekshirsin. Bu oddiy JWT imzo tekshiruvi o‘rniga emas, qo‘shimcha lifecycle tekshiruvidir.

## 5. Company web va Account

Canonical URL’larni Shot `.env` bilan bir xil belgilang. Hozirgi namunada issuer `https://algorithco.trqsh.uz/account`, resource API host root’da. `/account/v1/licenses` kabi noto‘g‘ri URL hosil qilmang.

Mavjud `/signin`, `/signin?mode=signup`, email verification, MFA, native Approve/Deny va `/app/account` ishlatiladi. Signup yoki recovery’dan keyin native authorization transaction’i davom etishi end-to-end tekshirilsin. Eski pairing-code yo‘riqnomasi ishlatilmaydi: tekshirilgan provider `device_name`ni oladi, legacy `pairing` parametrini tashlaydi.

App Account API’si profil snapshot’i va Account center linklarini beradi. Profil, parol, MFA, social linking, barcha sessiyalar va deletion web’da boshqariladi. Hozirgi `/account/api/account/overview` browser cookie/CSRF talab qiladi; unga desktop Bearer yuborib bo‘lmaydi. Kelajakda to‘liq native account mutation kerak bo‘lsa, alohida scope/recent-auth/step-up kontrakti zarur.

## 6. Qabul tekshiruvi

1. Markaziy client/product/scopes, kalitlar va Shot `.env`ni sozlang.
2. Repo ildizidan `pnpm --dir shot-api account:check` bajaring. Bu discovery, scope va ikkala public key domenini tekshiradi, loginni chetlab o‘tmaydi.
3. Native browser login bilan `shot-desktop` registration’i, PKCE, nonce, callback va Approve/Deny’ni alohida tekshiring. Public discovery client ro‘yxatini bermaydi.
4. Ixtiyoriy `ACCOUNT_CHECK_ACCESS_TOKEN` environment orqali yangi Shot access token bering va `account:check`ni qaytaring: token va entitlement ham tekshiriladi. Tokenni CLI argumenti yoki commit qilingan faylga yozmang. Checker token/profile’ni chiqarmaydi va license yaratmaydi.
5. App API’da `/me`, `/me/access` va `/me/offline-license` oqimini bajaring. Noto‘g‘ri product, device yoki boshqa user license ololmasligi tekshirilsin.
6. Account center’dan aynan Shot app grant’ini revoke qiling; keyingi refresh rad etilsin. Email-verification, blocked/deleting user va key rotation ssenariylarini ham tekshiring.

Markaziy tizim tayyor bo‘lguncha Shot API `/health` bilan live bo‘la oladi. `/ready` uchun ishonchli OIDC/license public keylar kerak; protected endpointlar valid token va Shot ruxsatisiz foydalanishga ochilmaydi.
