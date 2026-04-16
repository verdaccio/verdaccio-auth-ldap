#!/bin/bash
set -e

REALM="MYCOMPANY.DE"
DOMAIN="MYCOMPANY"
ADMIN_PASS="P@ssw0rd123"

echo "==> Provisioning Samba AD domain ${REALM}..."
rm -f /etc/samba/smb.conf

samba-tool domain provision \
  --realm="$REALM" \
  --domain="$DOMAIN" \
  --server-role=dc \
  --dns-backend=SAMBA_INTERNAL \
  --adminpass="$ADMIN_PASS" \
  --use-rfc2307

# Allow simple LDAP binds — Verdaccio uses plain LDAP, not Kerberos/SASL
sed -i '/^\[global\]/a\\tldap server require strong auth = no' /etc/samba/smb.conf

# Relax password policy so test users can have simple passwords
samba-tool domain passwordsettings set \
  --complexity=off \
  --min-pwd-length=4 \
  --min-pwd-age=0 \
  --max-pwd-age=0

# ── Seed directory (modelled after issue #3) ──
echo "==> Seeding directory..."

# Organizational units
samba-tool ou create "OU=CompanyUsers,DC=mycompany,DC=de"
samba-tool ou create "OU=CompanyGroups,DC=mycompany,DC=de"

# Test user — matches the example from
# https://github.com/verdaccio/verdaccio-auth-ldap/issues/3
#
#   dn:  CN=Christoph Fiehe,OU=CompanyUsers,DC=mycompany,DC=de
#   sAMAccountName: cfiehe
#   memberOf: CN=GroupA,OU=CompanyGroups,DC=mycompany,DC=de
#   memberOf: CN=GroupB,OU=CompanyGroups,DC=mycompany,DC=de
samba-tool user create cfiehe testpassword \
  --given-name=Christoph \
  --surname=Fiehe \
  --mail-address=cfiehe@mycompany.de \
  --userou="OU=CompanyUsers"

# Groups (AD creates them as CN=<name>,OU=...; member holds user DNs)
samba-tool group add GroupA --groupou="OU=CompanyGroups"
samba-tool group add GroupB --groupou="OU=CompanyGroups"

samba-tool group addmembers GroupA cfiehe
samba-tool group addmembers GroupB cfiehe

echo "==> Verifying user entry..."
# Use ldbsearch (local) to confirm memberOf is populated
ldbsearch -H /var/lib/samba/private/sam.ldb \
  "(sAMAccountName=cfiehe)" dn sAMAccountName memberOf cn

echo "==> Seed complete. Starting Samba AD DC..."
exec samba --foreground --no-process-group
