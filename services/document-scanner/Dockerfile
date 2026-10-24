FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends clamav-daemon clamdscan clamav-freshclam ca-certificates tini gosu \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o clamav -g clamav /run/clamav /var/lib/clamav /app
COPY services/document-scanner/server.mjs services/document-scanner/protocol.mjs /app/
COPY services/document-scanner/clamd.conf services/document-scanner/freshclam.conf /etc/clamav/
COPY services/document-scanner/entrypoint.sh services/document-scanner/run.sh /app/
ENV TZ=UTC PORT=3000 CLAMD_SOCKET=/run/clamav/clamd.sock
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/bin/bash", "/app/entrypoint.sh"]
