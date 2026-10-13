// Seed files for the Northline demo. Real SOP, brief and rule content so the reading view,
// search and editor are exercised with realistic markdown.

export const files: Record<string, Record<string, string>> = {
  northline: {
    "README.md": `# Northline company brain

This space holds how Northline works: our SOPs, brand voice and the compliance rules every
piece of client work must follow. Agents load it on every task.

| Folder | What's in it | Who can change it |
|---|---|---|
| \`locked/\` | Compliance and brand rules | Owners only, through review |
| \`sops/\` | How we do recurring work | Anyone, through review |
| \`brand/\` | Voice, examples, words we avoid | Anyone, through review |
| \`rules/\` | Rules learned from feedback | Approved by owners |

Changes here open a review on GitHub. Nothing reaches everyone until an owner approves it.
`,
    "locked/compliance.md": `# Compliance rules

These apply to every deliverable for every client. They are loaded in full before any
task and override everything else except a direct instruction from Maya.

## Advertising claims

1. Never promise a specific price, discount or financing rate unless the client's brief
   states it and gives an end date.
2. Never claim a contractor is "licensed", "bonded" or "insured" unless the license number
   is in the client brief. Include the number in the ad.
3. No before/after photos unless the client has confirmed in writing that the photos are
   their own work.
4. No "#1", "best in town" or other superlatives without a named, dated source.

## Housing and lending

- Ads that mention financing must run in the **Credit** special ad category on Meta.
- Never target or exclude by age, gender or ZIP code for financing ads.

## Reviews and testimonials

- Quote reviews word for word. Fix nothing except obvious typos.
- Always name the platform the review came from (Google, Yelp, Angi).

## When in doubt

Stop and ask in \`#compliance\`. A late ad is fine. A non-compliant ad is not.
`,
    "locked/brand-voice.md": `# Northline brand voice

We write like a trusted local contractor talks: direct, warm, specific.

## Principles

- **Specific beats clever.** "Roof inspected in 30 minutes" beats "Roofing done right".
- **Talk to one homeowner.** Use "you", never "homeowners" or "customers".
- **Calm, never pushy.** Our clients' customers are often stressed. Reassure them.

## Words we avoid

| Avoid | Use instead |
|---|---|
| Act now | Book when it suits you |
| Unbeatable | Name the actual benefit |
| Synergy, solutions | Say what the service is |
| Cheap | Fair, upfront price |
`,
    "sops/onboarding-a-client.md": `# Onboarding a new client

Owner: Priya. Target: the client's space exists and the team can work within one day of
signing.

## Steps

1. **Create the client space** in SelfHub: kind *Client*, name it after the business.
2. **Fill in \`brief.md\`** from the kickoff call. Required sections:
   - Services and service area
   - License numbers (see \`locked/compliance.md\`)
   - Offers with end dates
   - Tone notes and words to avoid
3. **Give access** to the ads team and the account manager. Nobody else.
4. **Add the first rules** the client gave us on the call to \`rules/learned.md\`.
5. **Post in #clients** with a link to the space.

## Checklist

- [ ] Space created
- [ ] Brief complete
- [ ] Access set
- [ ] Kickoff notes saved to \`work/\`
`,
    "sops/ad-review.md": `# Reviewing ads before they ship

Every ad gets one review by someone who didn't write it.

1. Read the client brief first. Then read the ad.
2. Check every claim against \`locked/compliance.md\`.
3. Check tone against the client's rules and \`locked/brand-voice.md\`.
4. If something is wrong, say **why** in one sentence. The agent turns that into a rule.

> A good review comment names the cause: "Too pushy, Apex hates urgency" teaches the agent
> something. "Not great" doesn't.
`,
    "brand/tone-examples.md": `# Tone examples

## Good

> Hail last night? We'll inspect your roof this week and send photos of anything we find.
> No pressure, no surprise fees.

## Not us

> HUGE STORM SALE!!! Call NOW before it's too late!!!
`,
    "rules/learned.md": `# Learned rules: Northline

Rules approved by owners from review feedback. They apply to every client.

- **Never use all caps for emphasis in ad copy.** Why: reads as shouting; flagged by
  Jordan on three clients. Approved by Maya, 2026-09-02.
- **Every ad ends with one clear next step.** Why: ads with two calls to action
  underperformed. Approved by Maya, 2026-09-18.
`,
  },

  "ads-team": {
    "README.md": `# Ads team

Shared workflows for the ads team. Everyone on the team can edit these directly; changes
sync to GitHub as soon as you save.
`,
    "sops/facebook-ads.md": `# Facebook and Instagram ads

## Before you start

- Load the client's space and read \`brief.md\` and \`rules/learned.md\`.
- Check the offer has an end date. No end date, no offer in the ad.

## Structure

1. **Hook** (first line, under 90 characters). Lead with the homeowner's problem.
2. **Proof.** One specific detail: years in business, a review quote, a license number.
3. **Offer**, if the brief has one.
4. **One call to action.**

## Variants

Write three variants that differ in the hook, not in the offer. Label them A, B, C.

## Image notes

| Format | Size | Notes |
|---|---|---|
| Feed | 1080 × 1350 | Real job photos beat stock |
| Stories | 1080 × 1920 | Keep text in the middle 60% |
`,
    "sops/google-ads.md": `# Google search ads

- Headlines: 3 pinned, up to 15 total. Include the city in at least one.
- Use the client's license number in a description line where the brief allows.
- Negative keywords to add for every home-services client: \`jobs\`, \`salary\`, \`diy\`,
  \`free\`.
`,
    "templates/campaign-naming.csv": `field,format,example
client,short client code,APEX
objective,leads | calls | awareness,leads
audience,{city}_{age_range},denver_35-70
offer,{offer_slug}_{end_date},hail-inspection_2026-11-30
variant,A | B | C,B
`,
    "templates/ad-brief.md": `# Ad brief template

- **Client:**
- **Platform:**
- **Goal:** calls / form fills / awareness
- **Offer and end date:**
- **Audience:**
- **Must include:**
- **Must avoid:**
`,
    "rules/learned.md": `# Learned rules: Ads team

- **Write three variants that differ only in the hook.** Why: makes test results readable.
  Approved by Jordan, 2026-08-21.
`,
  },

  apex: {
    "brief.md": `# Apex Roofing: client brief

Family-owned roofing company in Denver, founded 1998. Owner: Dana Ruiz.

## Services

- Roof inspections (free, 30 minutes)
- Storm and hail damage repair, including insurance claim help
- Full replacements: asphalt shingle, metal

**Service area:** Denver metro, Boulder, Golden.

## License and proof

- Colorado roofing license **RC-118204**
- 4.9 stars on Google from 612 reviews
- GAF Master Elite contractor

## Current offer

Free hail-damage inspection with photos, through **November 30, 2026**.

## Tone

Calm and neighborly. Dana's words: "We're the roofer your dad trusted." Apex hates
urgency and countdown language.

## Contacts

| Name | Role | Prefers |
|---|---|---|
| Dana Ruiz | Owner, approves ads | Email |
| Marco Ruiz | Operations | Phone |
`,
    "work/2026-10-12-spring-promo.md": `# Spring promo: Facebook ads

Draft for review. Offer: free hail-damage inspection through November 30.

## Variant A

> Hail last week? We'll check your roof for free and send you photos of anything we find.
> Apex Roofing, Denver's family roofer since 1998. License RC-118204.

## Variant B

> 612 Denver homeowners gave us 4.9 stars. Book a free hail inspection when it suits you.

## Variant C

> Not sure if the storm hurt your roof? A 30-minute inspection tells you for sure. Free
> through November 30.
`,
    "work/2026-08-storm-season.md": `# Storm season campaign: results

- Spend: $4,200 over 3 weeks
- 61 inspection bookings, $68.85 each
- Best hook: the hail-damage photo ("Here's what hail does to a 10-year-old roof")
- Worst: anything mentioning insurance first
`,
    "rules/learned.md": `# Learned rules: Apex Roofing

- **Lead with the inspection, never with insurance.** Why: insurance-first ads had 3x the
  cost per booking. Approved by Priya, 2026-08-30.
- **Always mention "family-owned since 1998".** Why: Dana asked on the kickoff call.
  Approved by Priya, 2026-06-14.
- **Use real job photos, never stock.** Why: client request. Approved by Jordan,
  2026-07-03.
`,
  },

  bolt: {
    "brief.md": `# Bolt HVAC: client brief

Heating and cooling in Aurora. Owner: Kevin Osei.

## Services

- Furnace and AC repair, 24/7
- Heat pump installs (rebate eligible)
`,
    "work/2026-10-furnace-tuneup.md": `# Furnace tune-up campaign

Draft. $89 tune-up through October 31.
`,
    "rules/learned.md": `# Learned rules: Bolt HVAC

- **Always mention 24/7 emergency service.**
`,
  },

  content: {
    "content-calendar.md": `# Content calendar: Q4 2026

| Week | Client | Piece | Owner | Status |
|---|---|---|---|---|
| Oct 12 | Apex Roofing | Hail damage: what to look for | Sam | Drafting |
| Oct 19 | Bolt HVAC | Furnace smells: when to worry | Priya | Brief |
| Oct 26 | Apex Roofing | Metal vs shingle in Colorado | Sam | Idea |
| Nov 2 | Northline | Case study: storm season | Maya | Idea |
`,
    "sops/blog-posts.md": `# Writing client blog posts

- 800 to 1,200 words. One question per post, answered in the first paragraph.
- Use the client's brief for facts. Never invent numbers.
- End with the client's offer if they have one, otherwise their phone number.
`,
  },

  "personal-sam": {
    "sops/ads.md": `# My ads SOP

How I like to work on ads. Agents load this when I ask for ad work.

1. Read the client brief and learned rules first. Always.
2. Start from the homeowner's problem, never from the client's company.
3. Write 3 variants. Make the hooks genuinely different.
4. Check \`locked/compliance.md\` claims before I send for review.
5. Send to Jordan with a one-line note on what I'm testing.

## Hooks that have worked

- A photo of real damage with a plain caption
- "Not sure if…" questions
- Star rating plus review count
`,
    "preferences.md": `# Preferences

- Short drafts first, then I'll ask for more.
- Use American spelling.
- Cite sources at the end of every deliverable.
`,
    "notes/2026-10-11.md": `# Notes, Oct 11

- Apex spring promo: Dana wants the hail angle again. Avoid anything that sounds urgent.
- Ask Jordan about the new Google Ads headline limits.
`,
  },

  "personal-maya": {
    "preferences.md": `# Preferences

- Summaries first, details on request.
- Flag compliance risks at the top.
`,
    "notes/planning.md": `# Q4 planning

- Hire a second ads specialist by December.
- Move every client to its own space by end of October.
`,
  },

  archive: {
    "README.md": `# Northline archive

Old client work from before SelfHub. Read only.
`,
  },
};
