# BackEnd para el Trabajo 3 de Auditoría Informática

Aplicación que realice las siguientes actividades de Auditoria de Bases de Datos para SQL Server:

- Identificación automática de las relaciones que requieren integridad referencial, que existen y que deberían existir
- Chequeo automático de anomalías en la definición de la integridad referencial para inserción, eliminación y actualización de información
- Chequeo automático de las anomalías de los datos

## Url

Agregar dentro de la url como query de `/api/auditoria/1?user=usuario_db&password=contraseña_db&database=nombre_db`

| url               | accion                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `api/auditoria/1` | Chequeo de anomalias en datos huerfanos                                                             |
| `/ap/auditoria/2` | Chequeo de anomalias en datos - valores repetidos                                                   |
| `/ap/auditoria/3` | Chequeo de anomalias en datos - cumplir fk                                                          |
| `/ap/auditoria/4` | Chequeo de anomalias en la definicion de la integridad referencial para eliminacion y actualizacion |
| `/ap/auditoria/5` | Chequeo de anomalias en la definicion de la integridad referencial para insercion                   |
| `/ap/auditoria/6` | Chequeo de anomalias en la definicion de PK                                                         |
| `/ap/auditoria/7` | Posibles relaciones que existen (Triggers)                                                          |
| `/ap/auditoria/8` | Relaciones que deberian existir                                                                     |
| `/ap/auditoria/9` | Relaciones que existen (FK)                                                                         |

# Ejecucion

```
npm run start o pnpm start
```