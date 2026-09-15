Coloca aqui la cadena PEM de la CA que emitio los certificados de firma:

- trust-chain.pem

Incluye la cadena necesaria (intermedias y raiz) y no claves privadas. El
mismo archivo se monta en SignServer y en el servicio de validacion.

La CA administrativa de SignServer es independiente y debe colocarse como
`runtime/admin/admin-ca.pem`. No uses la CA de firma para administrar el
servidor.
