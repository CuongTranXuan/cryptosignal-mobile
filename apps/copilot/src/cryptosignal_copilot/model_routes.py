from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from cryptosignal_copilot.model_catalog import NormalizedModel

# Longest-first so `-xhigh` wins over `-high`.
_EFFORT_SUFFIXES: tuple[tuple[str, str], ...] = (
    ("-xhigh", "xhigh"),
    ("-max", "max"),
    ("-high", "high"),
    ("-medium", "medium"),
    ("-low", "low"),
    ("-minimal", "minimal"),
    ("-none", "none"),
)


def parse_route_id(model_id: str) -> tuple[str, str | None]:
    """Return `(canonical_id, effort_tier)` for OmniRoute agentrouter variants."""
    route = model_id
    no_think = False
    if "/no-think/" in route:
        no_think = True
        route = route.replace("/no-think/", "/")

    if "/" not in route:
        return route, "none" if no_think else None

    provider, name = route.rsplit("/", 1)
    for suffix, effort in _EFFORT_SUFFIXES:
        if name.endswith(suffix):
            base_name = name[: -len(suffix)]
            canonical = f"{provider}/{base_name}"
            return canonical, "none" if no_think else effort

    if no_think:
        return route, "none"
    return route, None


def collapse_variant_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge effort / no-think routes into one catalog row per canonical model id."""
    groups: dict[str, list[tuple[str | None, dict[str, Any]]]] = {}
    for row in rows:
        model_id = str(row.get("id") or "")
        if not model_id:
            continue
        canonical, effort = parse_route_id(model_id)
        groups.setdefault(canonical, []).append((effort, row))

    collapsed: list[dict[str, Any]] = []
    for canonical, variants in groups.items():
        effort_routes: dict[str, str] = {}
        representative: dict[str, Any] | None = None
        for effort, row in variants:
            if effort is None:
                representative = dict(row)
            else:
                effort_routes[effort] = str(row["id"])
        if representative is None:
            representative = dict(variants[0][1])
        representative["id"] = canonical
        if effort_routes:
            representative["_effort_routes"] = effort_routes
        collapsed.append(representative)
    return collapsed


def resolve_provider_model_id(model: NormalizedModel, reasoning_effort: str | None) -> str:
    """Pick the upstream route id when OmniRoute exposes per-effort model ids."""
    routes = dict(model.effort_routes)
    if reasoning_effort == "none":
        if "none" in routes:
            return routes["none"]
        return model.id
    if reasoning_effort and reasoning_effort in routes:
        return routes[reasoning_effort]
    return model.id


def strip_thinking_when_routed(
    model: NormalizedModel,
    reasoning_effort: str | None,
    settings: dict[str, Any],
) -> dict[str, Any]:  # ModelSettings-compatible
    """Avoid sending unified `thinking` when the provider route encodes effort."""
    routed = resolve_provider_model_id(model, reasoning_effort)
    if routed == model.id:
        return settings
    cleaned = dict(settings)
    cleaned.pop("thinking", None)
    return cleaned
