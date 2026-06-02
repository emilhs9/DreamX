# Müvəqqəti Public Tunnel

Lokal server işləyərkən public test linki açmaq üçün:

```bash
npm start
```

Başqa terminalda:

```bash
npm run tunnel:serveo
```

Terminalda belə bir link çıxacaq:

```text
Forwarding HTTP traffic from https://...serveousercontent.com
```

Panel həmin linkdə açılır. Deploy olunan saytlar:

```text
https://...serveousercontent.com/@layihe-adi/
```

Qeyd: Bu müvəqqəti linkdir. Terminal və kompüter açıq qaldıqca işləyir. Daimi
domain üçün `DEPLOY_LINUX_HTTPS.md` faylındakı Linux + Nginx + HTTPS addımlarını
etmək lazımdır.

Serveo-da xüsusi subdomain istəsəniz, SSH key qeydiyyatı tələb olunur. Real və
daimi səliqəli domain üçün ən stabil yol öz Linux serverinizdə DNS + Nginx +
HTTPS qurmaqdır.
