{{- define "aveon.name" -}}{{ .Release.Name }}-aveon{{- end -}}

{{- define "aveon.labels" -}}
app.kubernetes.io/part-of: aveon
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/* Environment variable holding a tenant's HS256 secret. */}}
{{- define "aveon.tenantEnv" -}}TENANT_{{ . | upper | replace "-" "_" }}_JWT_SECRET{{- end -}}

{{- define "aveon.publicUrl" -}}
{{- if .Values.apiConnect.publicUrl -}}
{{ .Values.apiConnect.publicUrl }}
{{- else -}}
{{ if .Values.ingress.tlsSecretName }}https{{ else }}http{{ end }}://{{ .Values.host }}
{{- end -}}
{{- end -}}

{{- define "aveon.securityContext" -}}
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
{{- end -}}
