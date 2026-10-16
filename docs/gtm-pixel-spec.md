# Komorebi Pixel — GTM Implementation Spec

**Offer:** AutoCamp (`invest.autocamp.com`)
**Goal:** Attribute Komorebi's paid traffic (primarily Meta) to leads, account creation, and completed investments.

Everything is done through GTM using Custom HTML tags. No backend work is needed. The webhook integration continues separately for future issuers.

---

## How it works

1. A small script loads on every page and saves the visitor's UTMs and click IDs (`fbclid`, `gclid`, etc.) from the landing URL in first-party storage.
2. At each funnel step, a GTM tag calls `komorebi('track', ...)`. The saved attribution data is attached to every event automatically.
3. Events go to `https://komorebi-attribution.vercel.app/api/collect`. They are sent with `navigator.sendBeacon`, so they don't block the page or navigation.

The script ignores the default `utm_source=direct` / `(none)` values on internal links, so original attribution is preserved through checkout.

---

## Tag 1 — Komorebi Base (all pages)

- **Type:** Custom HTML
- **Trigger:** All Pages (Page View) on `invest.autocamp.com`, **including `/checkout`**
- **Tag firing priority:** 100, so it fires before the event tags

```html
<script>
!function(w,d){if(w.komorebi)return;var k=w.komorebi=function(){(k.q=k.q||[]).push(arguments)};k.q=[];var s=d.createElement('script');s.async=1;s.src='https://komorebi-attribution.vercel.app/pixel.js';d.head.appendChild(s)}(window,document);
komorebi('init', { offer: 'autocamp' });
</script>
```

---

## Tags 2–4 — Funnel events

One Custom HTML tag per step. Each tag must fire on the trigger your team already uses for that step, for example a `dataLayer` event from the DealMaker investor flow.

Replace the `{{...}}` placeholders with your GTM variables. If a value isn't available at that step, **leave the line out**. Don't send empty strings or placeholders.

### Tag 2 — Lead
```html
<script>
komorebi('track', 'lead', {
  investor_id: {{DM - Investor ID}},
  email: {{DM - Email}}
});
</script>
```

### Tag 3 — Account created
```html
<script>
komorebi('track', 'account_created', {
  investor_id: {{DM - Investor ID}},
  email: {{DM - Email}}
});
</script>
```

### Tag 4 — Investment complete
```html
<script>
komorebi('track', 'investment_complete', {
  investor_id:   {{DM - Investor ID}},
  investment_id: {{DM - Investment / Transaction ID}},
  amount:        {{DM - Investment Amount}},
  currency:      'USD',
  email:         {{DM - Email}}
});
</script>
```

### Field reference

| Field | Required | Notes |
|---|---|---|
| `investor_id` | Strongly preferred | DealMaker's investor/subscriber ID. Lets us reconcile with DealMaker reports and later webhook data. |
| `investment_id` | Strongly preferred (investment step) | Unique transaction ID. Used for de-duplication. |
| `amount` | Preferred | Number, no currency symbols. |
| `currency` | Optional | Defaults to USD if omitted. |
| `email` | Optional | **Hashed in the browser (SHA-256) before sending.** The raw email never leaves the page. |

Event names are fixed: `lead`, `account_created`, `investment_complete`. Lowercase letters, numbers, and underscores are accepted if you need an extra step (e.g. `investment_started`).

---

## Questions for your team

1. **Triggers:** What are the `dataLayer` event names the DealMaker investor flow pushes for lead, account created, and investment complete? We saw a `traffic` event with `dealUuid` on `/checkout`.
2. **Variables:** Which of `investor_id`, `investment_id`, `amount`, and `email` are available in the `dataLayer` at each step?
3. **Investment complete:** Does that event fire when the investor submits, or when payment is confirmed? Either works; we just need to know which.
4. **Other pages:** Does any part of the flow leave `invest.autocamp.com`, for example a redirect to a `dealmaker.tech` domain? If so, the base tag needs to run there too, or the URL needs to keep its parameters.

---

## QA

After publishing in GTM Preview:
1. Open `https://invest.autocamp.com/?utm_source=facebook&utm_medium=paid&utm_campaign=qa_test&fbclid=QA123`.
2. Go through the funnel.
3. In DevTools → Network, filter for `collect`. You should see a request for `page_view` and for each funnel step, each returning `200 {"success":true}`.

Send us the time of the test. We'll confirm on our side that the events arrived with the `qa_test` campaign attached.
