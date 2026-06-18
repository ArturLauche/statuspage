[![Health Check](../../actions/workflows/health-check.yml/badge.svg)](../../actions/workflows/health-check.yml)

# Lauche System Status

A lightweight, dependency-free status page for Lauche websites and services.
It renders 30 days of uptime history straight from the health-check logs in
this repository — no backend, no build step, just static files.

## Features

- **Aggregate status banner** that summarizes every service at a glance.
- **Light & dark themes** that follow the system preference and can be toggled
  (the choice is remembered).
- **30-day uptime bars** per service with hover tooltips and uptime percentage.
- **Live "last updated" indicator** and automatic refresh every minute.
- **Service filter** and a color legend.
- **Fully responsive**, accessible markup with reduced-motion support.

> Built on top of [Statsig's open-source status page](https://github.com/statsig-io/statuspage/).

## Setup instructions

1. Fork the [template repository](https://github.com/statsig-io/statuspage/).

2. Update urls.cfg to include your urls.

```cfg

key1=https://example.com

key2=https://statsig.com

```

3. Update index.html and change the title.

```html

<title>My Status Page</title>

<h1>Services Status</h1>

```

4. Set up GitHub Pages for your repository.

![image](https://user-images.githubusercontent.com/74588208/121419015-5f4dc200-c920-11eb-9b14-a275ef5e2a19.png)

## How does it work?

This project uses GitHub actions to wake up every 5 minutes and run a shell script (`health-check.sh`). This script runs curl on every URL in your config and appends the result of that run to a log file and commits it to the repository. This log is then pulled dynamically from index.html and displayed in an easily consumable fashion. You can also run that script from your own infrastructure to update the status page more often.

### Adaptive check intervals

`health-check.sh` can now check services less frequently when they are healthy.

- If the previous result is `success`, it waits `SUCCESS_CHECK_INTERVAL_MINUTES` before checking again (default: `5`).
- If the previous result is `failed`, it waits `FAILURE_CHECK_INTERVAL_MINUTES` before checking again (default: `5`).

This keeps checks configurable while defaulting to every 5 minutes for both healthy and unhealthy services.

## What does it not do (yet)?

1. Incident management.

2. Outage duration tracking.

3. Updating status root-cause.

## Got new ideas?

Send in a PR - we'd love to integrate your ideas.

## In case…

You are looking for a developer friendly Feature flags, and A/B experimentation service for your product, check out: https://www.statsig.com

![Statsig status page](https://user-images.githubusercontent.com/74588208/146078161-778fcb99-4a59-4e39-9fc0-abef18d5ac52.png)
