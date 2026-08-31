#!/usr/bin/env python3
"""Verify the DNS wiring for the Supabase custom domain api.gift.ceo.

Records to create at Porkbun (zone gift.ceo). Porkbun appends the zone to
whatever you type in "host", so the host field holds the *label only*:

    type   host               answer                              ttl
    CNAME  api                gcfurwexhxqxuveojoih.supabase.co    600
    TXT    _acme-challenge.api  <token Supabase shows on Verify>  600

Typing the full "api.gift.ceo" into the host field silently creates
api.gift.ceo.gift.ceo, and Supabase reports that only as "verification
failed" - which is exactly the state this script exists to catch.

There is no `dig` in most containers, so this speaks DNS over UDP to the
system resolvers directly. Run it after saving each record:

    python3 scripts/check-custom-domain.py

Exit code 0 means every check passed.
"""
import random
import socket
import struct
import sys

PROJECT_REF = "gcfurwexhxqxuveojoih"
TARGET = f"{PROJECT_REF}.supabase.co"
DOMAIN = "api.gift.ceo"
APEX = "gift.ceo"
# Classic Porkbun mistake: typing the full FQDN into the "host" field, which
# Porkbun then appends the zone to. Supabase only ever says "verification
# failed" for this, never why.
TRAP = f"{DOMAIN}.{APEX}"

TYPES = {1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 16: "TXT", 28: "AAAA"}
RCODES = {0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 5: "REFUSED"}


def resolvers():
    found = []
    try:
        with open("/etc/resolv.conf") as fh:
            for line in fh:
                if line.startswith("nameserver"):
                    found.append(line.split()[1])
    except OSError:
        pass
    return found or ["8.8.8.8", "1.1.1.1"]


def encode(name):
    out = b""
    for label in name.rstrip(".").split("."):
        out += bytes([len(label)]) + label.encode()
    return out + b"\x00"


def read_name(buf, off):
    labels = []
    jumped = False
    end = off
    while True:
        length = buf[off]
        if length & 0xC0 == 0xC0:  # compression pointer
            ptr = struct.unpack("!H", buf[off:off + 2])[0] & 0x3FFF
            if not jumped:
                end = off + 2
            off, jumped = ptr, True
            continue
        off += 1
        if length == 0:
            if not jumped:
                end = off
            break
        labels.append(buf[off:off + length].decode("ascii", "replace"))
        off += length
    return ".".join(labels), end


def query(name, qtype, server, timeout=4.0):
    qid = random.randint(0, 0xFFFF)
    packet = struct.pack("!HHHHHH", qid, 0x0100, 1, 0, 0, 0)
    packet += encode(name) + struct.pack("!HH", qtype, 1)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(packet, (server, 53))
        buf, _ = sock.recvfrom(4096)
    finally:
        sock.close()

    flags, qd, an = struct.unpack("!HHH", buf[2:8])[0], *struct.unpack("!HH", buf[4:8])
    rcode = flags & 0xF
    off = 12
    for _ in range(qd):
        _, off = read_name(buf, off)
        off += 4

    answers = []
    for _ in range(an):
        rname, off = read_name(buf, off)
        rtype, _, ttl, rdlen = struct.unpack("!HHIH", buf[off:off + 10])
        off += 10
        rdata = buf[off:off + rdlen]
        if rtype == 1:
            value = socket.inet_ntoa(rdata)
        elif rtype == 28:
            value = socket.inet_ntop(socket.AF_INET6, rdata)
        elif rtype in (2, 5):
            value, _ = read_name(buf, off)
        elif rtype == 16:
            value = rdata[1:1 + rdata[0]].decode("ascii", "replace")
        else:
            value = rdata.hex()
        answers.append((rname, TYPES.get(rtype, str(rtype)), value, ttl))
        off += rdlen
    return RCODES.get(rcode, str(rcode)), answers


def ask(name, qtype_name):
    qtype = next(k for k, v in TYPES.items() if v == qtype_name)
    last = ("NO-ANSWER", [])
    for server in resolvers():
        try:
            return query(name, qtype, server)
        except (socket.timeout, OSError) as exc:
            last = (f"ERROR ({exc})", [])
    return last


def show(label, name, qtype_name):
    rcode, answers = ask(name, qtype_name)
    print(f"\n{label}")
    print(f"  {name} {qtype_name} -> {rcode}")
    for rname, rtype, value, ttl in answers:
        print(f"    {rname} {rtype} {value} (ttl {ttl})")
    return rcode, answers


def main():
    print(f"Supabase project : {TARGET}")
    print(f"Custom domain    : {DOMAIN}")

    apex_rc, apex_a = show("[apex] GitHub Pages should stay untouched", APEX, "A")
    cname_rc, cname = show("[1/5] the CNAME Supabase needs", DOMAIN, "CNAME")
    a_rc, a_recs = show("[2/5] what the domain resolves to", DOMAIN, "A")
    trap_rc, trap = show("[3/5] the api.gift.ceo.gift.ceo trap", TRAP, "CNAME")
    txt_rc, txt = show("[4/5] Supabase ownership/ACME validation record",
                       f"_acme-challenge.{DOMAIN}", "TXT")
    acme_trap_rc, acme_trap = show("[5/5] the _acme-challenge appended-zone trap",
                                   f"_acme-challenge.{DOMAIN}.{APEX}", "TXT")

    print("\n" + "=" * 60)
    problems = []
    ok = []

    targets = [v.rstrip(".").lower() for _, t, v, _ in cname if t == "CNAME"]
    if TARGET in targets:
        ok.append(f"CNAME {DOMAIN} -> {TARGET} is live")
    elif targets:
        problems.append(f"{DOMAIN} is a CNAME to {targets[0]}, expected {TARGET}")
    elif any(t == "A" for _, t, _, _ in a_recs):
        ips = [v for _, t, v, _ in a_recs if t == "A"]
        pages = [i for i in ips if i.startswith("185.199.")]
        if pages:
            problems.append(
                f"{DOMAIN} resolves to GitHub Pages {ips} - a wildcard or "
                f"ALIAS at the apex is catching it. The CNAME is missing or "
                f"is losing to a more specific record.")
        else:
            problems.append(f"{DOMAIN} has A records {ips} but no CNAME")
    else:
        problems.append(f"{DOMAIN} does not resolve yet ({cname_rc}) - "
                        f"either not saved at Porkbun, or still propagating")

    if trap_rc != "NXDOMAIN" and trap:
        problems.append(
            f"TRAP HIT: {TRAP} exists. The Porkbun host field holds the full "
            f"'{DOMAIN}' instead of just 'api'. Supabase will only ever say "
            f"'verification failed'. Fix: host = api")
    else:
        ok.append(f"no {TRAP} - the Porkbun host field is correct")

    if any(t == "A" and v.startswith("185.199.") for _, t, v, _ in apex_a):
        ok.append(f"{APEX} still points at GitHub Pages")
    elif apex_rc != "NOERROR":
        problems.append(f"{APEX} A lookup returned {apex_rc}")

    if txt:
        ok.append(f"_acme-challenge.{DOMAIN} TXT is set ({txt[0][2][:28]}...)")
    else:
        ok.append(f"no _acme-challenge.{DOMAIN} TXT yet - expected, Supabase "
                  f"only hands you that token after the CNAME verifies")

    if acme_trap_rc != "NXDOMAIN" and acme_trap:
        problems.append(
            f"TRAP HIT: _acme-challenge.{DOMAIN}.{APEX} exists. The Porkbun "
            f"host field must be '_acme-challenge.api', not the full name.")

    for line in ok:
        print(f"  OK   {line}")
    for line in problems:
        print(f"  FAIL {line}")
    print("=" * 60)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
