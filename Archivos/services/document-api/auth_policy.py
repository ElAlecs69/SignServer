def is_allowed_institutional_email(email: str, allowed_domains: tuple[str, ...]) -> bool:
    normalized = email.strip().lower()
    if normalized.count("@") != 1:
        return False

    local_part, domain = normalized.rsplit("@", 1)
    if not local_part or not domain:
        return False

    return domain in allowed_domains

"Prueba"