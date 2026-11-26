# nginx-unprivileged runs as non-root on port 8080 (fits restricted k8s pod security)
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web/ /usr/share/nginx/html/
EXPOSE 8080
