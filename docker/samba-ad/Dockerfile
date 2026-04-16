###############################################
# Samba Active Directory Domain Controller
#
# Provides a real AD DC for integration testing.
# The entrypoint provisions the domain, seeds
# test users/groups, then starts the DC.
###############################################
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Pre-configure krb5 to avoid interactive prompts
RUN echo "krb5-config krb5-config/default_realm string MYCOMPANY.DE" | debconf-set-selections && \
    echo "krb5-config krb5-config/kdc string" | debconf-set-selections && \
    echo "krb5-config krb5-config/admin_server string" | debconf-set-selections

RUN apt-get update && apt-get install -y --no-install-recommends \
      samba \
      samba-dsdb-modules \
      samba-vfs-modules \
      winbind \
      krb5-config \
      krb5-user \
      ldap-utils \
      ldb-tools \
    && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 389 636 88 464 53 3268 3269

ENTRYPOINT ["/entrypoint.sh"]
