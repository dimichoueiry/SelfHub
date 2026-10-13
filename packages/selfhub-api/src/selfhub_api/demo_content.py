# ruff: noqa: E501  (markdown tables cannot wrap)
"""Markdown for the Northline demo. Plain data; demo.py turns it into git history."""

from __future__ import annotations

# ---------- Northline (org) ----------

NORTHLINE_README = """# Northline — company brain

Northline is a 20-person marketing agency for home-service contractors (roofing, HVAC,
plumbing, solar). This space holds what every Northliner and every agent must follow.

| Folder | What's in it | Who changes it |
|---|---|---|
| `locked/` | Compliance and brand voice. Non-negotiable. | Admins only, through a reviewed PR |
| `sops/` | How we run onboarding, creative review and reporting | Anyone, through a PR |
| `handbook/` | How we work, for new hires | Anyone, through a PR |
| `rules/` | Rules agents learned from feedback | Proposed by anyone, approved by admins |

Every change here goes through a pull request. Nothing reaches `main` until a reviewer
merges it.
"""

COMPLIANCE = """# Advertising compliance

Applies to every ad, landing page, email and SMS we produce for any client. If a client
asks for something on this page, say no and explain why. Escalate to Maya if they push.

## 1. Claims

- **No guaranteed outcomes.** Never say "guaranteed approval", "guaranteed savings" or
  "your insurance will pay". Say "we'll help you file" or "many homeowners qualify".
- **No fake or invented reviews.** Only quote reviews we can link to (Google, BBB, Angi).
  Keep the reviewer's first name and last initial exactly as published.
- **Before/after photos must be real** jobs by that client. No stock photos presented as
  their work. Stock is fine for lifestyle shots if it isn't implied to be a job.
- **"Licensed and insured"** only when we have the license number on file in the client
  brief.

## 2. Pricing and financing

- Every financing mention needs the lender's disclaimer in the ad or the first screen of
  the landing page: *"Subject to credit approval. Minimum monthly payments required.
  See lender for terms."*
- "0%" or "no interest" must name the promo period ("0% APR for 12 months").
- A discount needs an end date and an exclusion line ("Not valid with other offers.").
- Never show a price we haven't confirmed in the client's `offers.md` that month.

## 3. Storm and insurance work

| Do | Don't |
|---|---|
| "Free inspection after the storm" | "Your roof was damaged in the storm" (we don't know that) |
| "We work with your insurance company" | "We'll get your roof paid for by insurance" |
| "Local since 2004" | Door-hanger language implying we're the city or the insurer |

Several states restrict contractors from waiving deductibles or acting as a public
adjuster. Never offer to "cover your deductible" in any state.

## 4. Licensing in ads

| State | Rule |
|---|---|
| Colorado | Roofing: no state license; show city license where required (Denver: yes) |
| Texas | HVAC: TACLA number must appear in all ads |
| Arizona | ROC license number required in all advertising |
| Florida | CCC/CBC number required in all advertising |

## 5. SMS and calls

- SMS only to people who opted in on a form that names the client and says "texts".
- Every SMS ends with "Reply STOP to opt out."
- No auto-dialed calls from ad leads unless the form had TCPA consent language.

## 6. Data

- Never paste lead names, phone numbers or emails into an AI tool or this repo.
- Lead lists live in the client's CRM, not in SelfHub.
"""

BRAND_VOICE = """# Northline brand voice

How we write for Northline itself, and the default voice for clients that don't define
their own in `brief.md`. A client's brief overrides this for that client.

## The short version

Plain, local, confident. Write like a good contractor talks at the kitchen table: no
hype, no jargon, specific about what happens next.

## Principles

1. **Specific beats clever.** "Inspection in 48 hours" beats "Lightning-fast service".
2. **Homeowner first.** Lead with their problem (leak, high bill, storm), not our awards.
3. **One ask per ad.** Book an inspection *or* call, never both in the headline.
4. **Proof, not adjectives.** Years in business, review count, warranty length.

## Words we don't use

| Avoid | Use instead |
|---|---|
| best-in-class, world-class | what makes them better, specifically |
| cheap | affordable, fair, upfront pricing |
| act now!!, don't miss out | (nothing; let the offer and date speak) |
| solutions | the actual service ("roof replacement") |
| utilize | use |

## Formatting

- Headlines: sentence case, under 40 characters for Meta, 30 for Google.
- At most one exclamation mark per ad, and never in the headline.
- Numbers as digits ("3 quotes", "$500 off").
- Emoji: none for roofing and HVAC clients unless their brief allows it.
"""

ONBOARDING_SOP = """# Client onboarding SOP

Owner: Priya (account management). Goal: from signed contract to first ads live in
**14 days**, with the client space complete enough that any agent can do good work.

## Day 0: contract signed

1. Create the client space: `selfhub space create` or **New space** in the dashboard.
   Kind = client, owners = the strategist and the account manager.
2. Give the ads team write access and the creative team write access on GitHub.
3. Book the kickoff call (60 min) within 3 business days.

## Kickoff call agenda

| Time | Topic | Output |
|---|---|---|
| 0–10 | Their business, service area, seasonality | `brief.md` → Who they are |
| 10–25 | Best customers and worst customers | `brief.md` → Audience |
| 25–40 | Offers, financing, what they won't do | `offers.md`, `brief.md` → Never do |
| 40–50 | Past ads: what worked, what didn't | `past-ads/` |
| 50–60 | Tracking: CRM, call tracking, who answers leads | `brief.md` → Contacts |

## Day 1–5

- Fill in `brief.md` the same day as the call while it's fresh.
- Collect license numbers (see `locked/compliance.md` §4) and logo files.
- Set up call tracking numbers; one per channel.

## Day 6–14

- Ads team builds the first campaigns from the team SOPs.
- Strategist reviews every first-round variant (see `sops/creative-review.md`).
- Launch, then schedule the first 7-day check-in.

## Done when

- [ ] `brief.md` has no empty sections
- [ ] `offers.md` lists every live offer with end dates
- [ ] At least one past ad in `past-ads/` (theirs or ours)
- [ ] Ads team and creative team have access
"""

CREATIVE_REVIEW_SOP = """# Creative review SOP

Every ad variant gets a review before launch. Reviews are where agents learn: a thumbs
down with a reason becomes a proposed rule.

## Checklist

1. **Compliance first.** Read it against `locked/compliance.md`. Any miss = reject.
2. **Client rules.** Check the client's `rules/learned.md` and `brief.md` → Never do.
3. **Offer accuracy.** Price, dates and disclaimers match `offers.md` this month.
4. **Voice.** Matches the client's brief, or Northline's voice if the brief is silent.
5. **One clear ask.** The CTA matches the campaign objective.

## Giving feedback

- Mark the variant 👍 or 👎. A 👎 must say *why* in one sentence.
- Say whether the reason is client-specific ("Apex hates urgency") or general
  ("never stack two discounts"). That decides where the rule lives.
- Don't fix the ad silently. Fix the cause, so the next ad doesn't need fixing.

## Turnaround

| Priority | Review within |
|---|---|
| Launch blocker | 4 business hours |
| Normal | 1 business day |
| Refresh / iteration | 2 business days |
"""

CREATIVE_REVIEW_A11Y = """
## Accessibility checks

- Text on images: at least 4.5:1 contrast, and the key claim also in the primary text.
- Video ads: burned-in captions; 80% of Meta video is watched muted.
- Don't put the phone number only inside an image.
"""

REPORTING_SOP = """# Monthly reporting SOP

Owner: the client's account manager. Due by the 5th business day of each month.

## Steps

1. Pull spend, leads and cost per lead per channel from Meta, Google Ads and LSA.
2. Pull booked jobs from the client's CRM; calculate cost per booked job.
3. Compare against the targets in the client's `brief.md` → KPIs.
4. Write three sentences: what worked, what didn't, what we change next month.
5. Save the summary to the client space under `work/reports/YYYY-MM.md`.

## Report table

| Channel | Spend | Leads | CPL | Booked jobs | Cost per job |
|---|---|---|---|---|---|
| Meta | | | | | |
| Google Search | | | | | |
| Google LSA | | | | | |

## Rules of thumb

- Report booked jobs, not just leads. Clients pay for jobs.
- If cost per lead rose more than 25% month over month, say why before they ask.
"""

HANDBOOK = """# How we work at Northline

Welcome. This is the page to read on day one.

## How work flows

1. A client signs → Priya creates their space and runs onboarding.
2. The ads team builds campaigns from the team SOPs and the client's brief.
3. Jordan (strategy) reviews creative. Feedback becomes rules, so mistakes don't repeat.
4. Account managers report monthly and keep `offers.md` current.

## Using SelfHub

- Before any client work, ask your agent for context ("Facebook ad for Apex, follow the
  ads SOP"). It loads the locked rules, that client and nothing else.
- Never copy one client's material into another client's space.
- If an agent output is wrong, say why. A good "why" becomes a rule for everyone.

## Who to ask

| Topic | Person |
|---|---|
| Compliance, anything in `locked/` | Maya Chen |
| Creative review, client strategy | Jordan Reyes |
| Client offers, onboarding, access | Priya Nair |
| Paid social | Sam Okafor |
| Paid search | Ken Ito |
| Tools, laptops, accounts | Marcus Bell |
"""

# ---------- Ads team ----------

ADS_README = """# Ads team

Shared workflows for paid social and paid search. Loaded on every task for people in the
ads team. Client-specific rules live in each client's space, not here.

- `sops/` — how we build and run campaigns, step by step
- `templates/` — briefs, variant sheets and naming conventions
- `rules/` — rules learned from creative review
"""

FACEBOOK_SOP = """# Facebook & Instagram ads SOP

For lead-gen campaigns for home-service clients. Follow the steps in order. Client
`brief.md` and client rules override anything here for that client.

## 1. Before you write anything

1. Read the client's `brief.md`, `offers.md` and `rules/learned.md`.
2. Check the offer is still live (end date in `offers.md`).
3. Look at the top 2 ads in `past-ads/` by cost per lead. Start from what worked.

## 2. Campaign structure

| Level | Setting |
|---|---|
| Campaign | Objective: Leads. Advantage+ budget on. One campaign per offer. |
| Ad set | Location: service area ZIPs from the brief, +10 mi radius max. Age 30–65+. |
| Ad set | Placements: Advantage+; exclude Audience Network. |
| Ad | 3 variants per ad set: one proof-led, one problem-led, one offer-led. |
| Form | Higher intent form. Questions: ZIP, service needed, timeline. |

## 3. Writing the variants

Every variant has the same skeleton:

1. **Hook** (first 125 characters): the homeowner's problem or a local proof point.
2. **Offer**: exactly as written in `offers.md`, with its end date.
3. **Proof**: years in business, review count or warranty. One, not all three.
4. **CTA**: one action. "Book your free inspection."
5. **Disclaimer** if financing or a discount is mentioned (see compliance §2).

Headlines under 40 characters. Primary text under 300 characters for the first variant.

## 4. Creative

- Real job photos from the client beat stock every time. Ask the AM if we have none.
- 1:1 and 4:5 for feed, 9:16 for Stories/Reels. Captions on every video.
- Put the offer in the image text only if it also appears in the primary text.

## 5. Naming

`{client}_{objective}_{offer}_{yyyymm}` for campaigns, e.g. `apex_leads_fall-inspection_202609`.
Full convention in `templates/campaign-naming.csv`.

## 6. Review and launch

1. Send the 3 variants to the strategist for review (see Northline creative review SOP).
2. Fix the cause of any 👎, not just the ad.
3. Launch Tuesday–Thursday morning. Never launch on a Friday.

## 7. First 7 days

| Day | Check |
|---|---|
| 1 | Leads arriving in the CRM? Form test submitted? |
| 3 | Any variant with 2× the account CPL and 1,000+ impressions → pause |
| 7 | Report CPL per variant to the AM; propose the next test |
"""

FACEBOOK_TESTING = """
## 8. Creative testing cadence

- Introduce **one** new variable per test: hook, image or offer framing. Never two.
- Each test runs until every variant has 50+ leads or 14 days, whichever comes first.
- Winners go into `past-ads/` in the client space with their numbers.
- Refresh creative every 4–6 weeks or when frequency passes 3.0.
"""

GOOGLE_SOP = """# Google Ads SOP (Search + Local Services)

For contractors, search captures people who already have the problem. Our job: show up
for high-intent searches in the service area and nothing else.

## 1. Account structure

| Campaign | Purpose | Bidding |
|---|---|---|
| Brand | Client's name and misspellings | Manual CPC, cap at $3 |
| Core services | "roof replacement denver", "ac repair near me" | Maximize conversions → tCPA after 30 conv. |
| Emergency | "emergency roof leak", "no heat" | Max conversions, ad schedule 24/7 |
| Local Services Ads | Google Guaranteed leads | Managed in LSA, budget set weekly |

## 2. Keywords

- Phrase and exact match only for the first 60 days.
- One ad group per service, 5–15 keywords each.
- Always include the service area city names as phrase-match variants.

## 3. Ads

- 1 responsive search ad per ad group with 12+ headlines and 4 descriptions.
- Pin headline 1 to the service + city ("Roof Replacement in Denver").
- Use the offer from `offers.md` in at least 2 headlines, with its end date in a
  description.
- Assets: call (tracked number), sitelinks (4), callouts (4), structured snippets.

## 4. Weekly routine

1. Search terms report: add negatives for anything that isn't a paying job.
2. Check impression share lost to budget on Emergency; flag to the AM if over 20%.
3. LSA: dispute any lead that's spam or outside the service area within 30 days.
"""

GOOGLE_NEGATIVES = """
## 5. Shared negative keyword list

Apply the `contractor-core` shared list to every non-brand campaign:

| Theme | Negatives |
|---|---|
| Jobs | jobs, hiring, salary, career, apprentice |
| DIY | diy, how to, youtube, home depot, lowes |
| Materials only | shingles for sale, wholesale, supplier |
| Free / cheap | free roof, government grant, cheap |
"""

AD_BRIEF_TEMPLATE = """# Ad brief — {client} — {campaign}

| Field | Value |
|---|---|
| Client | |
| Objective | Leads / Calls / Bookings |
| Offer (from offers.md) | |
| Offer end date | |
| Budget / day | |
| Service area | |
| Launch date | |

## The one thing this ad must make someone feel or know

## Proof we can use

## Client rules that apply (from rules/learned.md)

## Variants requested

1. Proof-led:
2. Problem-led:
3. Offer-led:
"""

VARIANTS_TEMPLATE = """# Facebook variant sheet

| # | Angle | Hook (≤125 chars) | Headline (≤40) | CTA | Image |
|---|---|---|---|---|---|
| 1 | Proof | | | | |
| 2 | Problem | | | | |
| 3 | Offer | | | | |

## Sources used

List every SelfHub file you used (space:path).
"""

NAMING_CSV = """level,pattern,example
campaign,{client}_{objective}_{offer}_{yyyymm},apex_leads_fall-inspection_202609
ad_set,{audience}_{geo}_{placement},homeowners-35plus_denver-metro_advplus
ad,{angle}_{format}_{version},proof_image_v2
utm_campaign,{client}-{offer}-{yyyymm},apex-fall-inspection-202609
"""

# ---------- Apex Roofing (client) ----------

APEX_BRIEF = """# Apex Roofing — client brief

## Who they are

Family-owned roofing company in the Denver metro, run by Rick and Dana Alvarado since
2004. 22 crew, 4 inspectors. GAF Master Elite contractor. 1,240 Google reviews, 4.8★.

## Services and service area

- Residential roof replacement (asphalt shingle, ~80% of revenue)
- Hail and wind damage inspections and insurance claim help
- Repairs and gutters
- Service area: Denver, Aurora, Lakewood, Littleton, Highlands Ranch, Parker, Castle Rock

## Audience

Homeowners 35–70 in single-family homes built before 2005. Best customers: just had a
hailstorm, roof 15+ years old, want one company to handle the insurance paperwork.

## Voice and tone

Calm, neighborly, unhurried. Rick says: "We're the roofer your neighbor already used."
Lead with trust and proof (20 years, reviews, warranty). Never pushy.

## Never do

- Urgency or scarcity language. They lose referrals when ads feel like storm chasers.
- Mention a specific price for a full replacement. Every roof is quoted on site.
- Show drones, ladders on steep pitches or anyone on a roof without fall protection.

## KPIs

| Metric | Target |
|---|---|
| Cost per lead (Meta) | ≤ $85 |
| Cost per booked inspection | ≤ $160 |
| Inspection → signed job | ≥ 35% |

## Contacts

| Role | Name | Notes |
|---|---|---|
| Owner | Rick Alvarado | Approves offers |
| Office manager | Dana Alvarado | Answers leads 8–6 M–F |
| Our AM | Priya Nair | |
| Our strategist | Jordan Reyes | |
"""

APEX_OFFERS = """# Apex Roofing — current offers

Check end dates before using any offer. Expired offers stay listed for reference.

| Offer | Details | Valid | Disclaimer |
|---|---|---|---|
| Free roof inspection | 45-min inspection with photo report, no obligation | Ongoing | — |
| Financing | 0% APR for 12 months through GreenSky on approved credit | Ongoing | Subject to credit approval. Minimum monthly payments required. See lender for terms. |
| Spring hail check | Free inspection + $250 off repairs | Apr 1 – May 31, 2026 (expired) | Not valid with other offers. |
"""

APEX_OFFERS_FALL = """| Fall replacement | $500 off a full roof replacement signed by Nov 30 | Sep 15 – Nov 30, 2026 | Not valid with other offers. One per household. |
"""

APEX_PAST_SPRING = """# Spring hail check — April 2026

| Field | Value |
|---|---|
| Channel | Meta (Facebook + Instagram) |
| Budget | $75/day, 30 days |
| Offer | Free inspection + $250 off repairs |

## Variants

| # | Angle | Hook | CPL | Leads |
|---|---|---|---|---|
| 1 | Proof | "1,200+ Denver neighbors trust Apex with their roof." | $62 | 41 |
| 2 | Problem | "Hail last week? Most damage isn't visible from the ground." | $54 | 58 |
| 3 | Offer | "Free inspection + $250 off repairs this spring." | $91 | 19 |

## What we learned

- Problem-led with a real hail photo from their own job won by a wide margin.
- Offer-led underperformed; Apex's audience responds to trust, not discounts.
"""

APEX_PAST_SUMMER = """# Summer financing push — July 2026

| Field | Value |
|---|---|
| Channel | Meta |
| Budget | $60/day, 21 days |
| Offer | 0% APR for 12 months (GreenSky) |

## Results

| # | Angle | CPL | Leads | Booked |
|---|---|---|---|---|
| 1 | Proof | $79 | 22 | 9 |
| 2 | Problem ("15-year-old roof?") | $71 | 27 | 12 |
| 3 | Offer | $96 | 14 | 4 |

## Notes

- Financing works as a second line, not the hook.
- Dana reported 3 leads complained the first variant "felt like a sales call". Tone
  down CTAs.
"""

APEX_PAST_FALL = """# Fall inspection campaign — September 2026

| Field | Value |
|---|---|
| Channel | Meta |
| Budget | $80/day, launched Sep 16 |
| Offer | Free inspection; $500 off replacement through Nov 30 |

## Week 1–2 results

| # | Angle | CPL | Leads |
|---|---|---|---|
| 1 | Proof ("20 years, 1,240 reviews") | $68 | 31 |
| 2 | Problem ("Before winter: check your roof") | $59 | 37 |
| 3 | Offer | $88 | 15 |
"""

APEX_PAST_FALL_LOCAL = """
## Week 3 (draft, not reviewed yet)

- Variant 2 still leading at $57 CPL. Frequency 2.4.
- Trying a new hook next week: neighbor testimonial video from the Littleton job.
"""

APEX_WORK_README = """# Work — Apex Roofing

Deliverables and drafts. One file per piece of work, named `YYYY-MM-DD-topic.md`.
"""

# ---------- Bolt HVAC (client) ----------

BOLT_BRIEF = """# Bolt HVAC — client brief

## Who they are

Heating and cooling company in Austin, TX. Founded 2016 by Marco Bellini, 14 technicians,
24/7 emergency service. TACLA licensed. 610 Google reviews, 4.7★.

## Services and service area

- AC repair and replacement, heat pumps, furnace repair
- Maintenance plan: "Bolt Club" ($19/month, two tune-ups a year)
- Service area: Austin, Round Rock, Cedar Park, Pflugerville, Georgetown

## Audience

Homeowners 30–60. Summer: AC broke, it's 104°F, they want someone today. Spring and
fall: tune-ups and replacement planning.

## Voice and tone

Fast, friendly, a little playful. Emoji allowed (one per ad, ❄️ or 🔥 only).

## Never do

- Advertise without the TACLA license number (compliance §4).
- Promise a same-day arrival time; say "same-day service available".

## KPIs

| Metric | Target |
|---|---|
| Cost per call (Google) | ≤ $45 |
| Bolt Club signups / month | 40 |
"""

BOLT_BRIEF_UPDATE = """
## Contacts

| Role | Name | Notes |
|---|---|---|
| Owner | Marco Bellini | Approves budget |
| Dispatcher | Renee Ortiz | Answers calls 7–7, 7 days |
| Our AM | Priya Nair | |
"""

BOLT_OFFERS = """# Bolt HVAC — current offers

| Offer | Details | Valid | Disclaimer |
|---|---|---|---|
| AC tune-up | $79 21-point tune-up | Apr 1 – Jun 30, 2026 (expired) | — |
| Bolt Club | $19/month, 2 tune-ups/year, no overtime fees | Ongoing | Cancel anytime. |
| Heat pump rebate | Up to $2,000 federal tax credit help | Ongoing | Tax credit eligibility varies. Consult a tax professional. |
"""

BOLT_PAST = """# AC tune-up — August 2026

| # | Angle | Channel | Cost per call | Calls |
|---|---|---|---|---|
| 1 | Problem ("AC struggling at 104°?") | Google Search | $38 | 64 |
| 2 | Offer ($79 tune-up) | Google Search | $41 | 52 |
| 3 | Club ("Never pay overtime again") | Meta | $57 | 18 |
"""

# ---------- Sam's personal space ----------

SAM_README = """# Sam's SelfHub

My own workflows, preferences and notes. Only I see this space.
"""

SAM_ADS_SOP = """# My ads workflow

How I like to work, on top of the team SOP.

1. Open the client's past ads first and copy the structure of the best CPL variant.
2. Write 5 hooks, keep 3. Read them out loud; cut anything I wouldn't say to a neighbor.
3. Ask the agent for 3 variants with the team skeleton; ask it to list its sources.
4. Send to Jordan before 2pm so review lands the same day.
"""

SAM_PREFS = """# Preferences

- Drafts in a table: angle, hook, headline, CTA.
- Show me CPL from past ads next to any hook idea.
- No emoji in drafts unless the client brief allows it.
"""

SAM_NOTES = """# Apex ideas — October

- Neighbor testimonial video (Littleton job) as a hook. Ask Priya if Rick approved it.
- Winter prep angle: "Ice dams start at the roof edge."
- Test a carousel of real before/after photos from 3 jobs.
"""
