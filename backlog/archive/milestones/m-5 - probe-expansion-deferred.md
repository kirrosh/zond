---
id: m-5
title: "probe-expansion-deferred"
---

## Description

Probe-классы, probe-ergonomics и probe-reporting, отложенные до validation-evidence.

Принцип: задачу из этого майлстоуна берём только когда конкретный run против реального API (Stripe / Resend / open-source FastAPI) показал, что соответствующий probe-класс или ergonomics-улучшение реально вытягивает баг или закрывает зафиксированное трение. Без такого сигнала — спекулятивное coverage, которое раздувает поверхность без пользователя.

Связь со стратегией: см. decision-5 (validation path) и m-6 (trust-loop-push). Сначала шерабельные артефакты доверия, потом расширение probe-арсенала по факту.
