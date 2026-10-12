---
name: reddit-growth
description: >
  Draft honest, disclosed Reddit replies that help people and, where it truly fits,
  mention our product. Use when looking for Reddit threads where our product is
  relevant, checking a subreddit's self-promotion rules, or drafting replies for a
  human to review and post. Never posts on its own.
---

# Reddit Growth

Find Reddit conversations where we can genuinely help, and draft replies a human reviews and posts. The aim is to be a useful, openly affiliated participant, not to look like an unaffiliated fan.

## Setup

Fill this in before the first run (or ask the user for it):

```
PRODUCT: name + one-line description (what it does, who it's for)
SUBREDDITS: communities where our users actually hang out
SIGNALS: phrases people use when they have the problem we solve
POSTER: the Reddit account the human will post from, and how they relate to the product
```

## Ground rules

1. **Drafts only.** Never log in, vote, message, or submit anything. Output text for the human to post.
2. **Disclose every time the product comes up.** Use plain wording in the reply itself, e.g. "(I work on X)" or "Full disclosure: I'm one of the founders." No mention, no disclosure needed.
3. **No fake experience.** Don't invent usage stories, results, or a persona. Don't suggest alt accounts or vote coordination.
4. **Subreddit rules win.** If a community bans self-promotion, the draft stays product-free or the thread is skipped.

## Choosing threads

Prefer threads where someone:
- asks for tool or product recommendations in our category
- describes the exact problem we solve
- asks how to do something our product helps with

Skip threads that are heated, off-topic for us, old enough that a reply would look like a link drop, or where a mention would feel pushy. If unsure, skip.

## Writing the draft

- Lead with an answer that's useful even if they never click anything: steps, trade-offs, alternatives (including competitors when they fit better).
- Mention the product in roughly one reply in four or five, only when it's a real fit, near the end, with disclosure.
- Write each reply fresh in the thread's own tone. No reused templates, no marketing voice, no hard calls to action.
- Link only if the subreddit allows it and the link helps more than the product name alone.
- Close with a question or an offer to help further when natural.

## Pacing guidance for the human

New accounts should spend their first week or two just helping, with no product mentions, so the community knows them for their contributions. After that, suggest keeping it to a couple of replies per subreddit per day, spaced out, and stepping back from any subreddit where a mod removes a post or warns the account.

## Output

For each run, return:

```
Thread: <title> — <link>
Subreddit rule notes: <self-promo allowed? links allowed?>
Action: help-only | help + disclosed mention | skip (reason)
Draft:
<reply text>
```

Finish with a one-line summary: threads reviewed, drafts written, skips and why.
