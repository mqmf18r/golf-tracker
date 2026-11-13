# GolfTracker

Aplicación móvil de golf construida con Expo y React Native. Permite gestionar campos y rondas, registrar golpes, consultar estadísticas y experimentar con análisis de vídeo mediante ShotVision.

> Estado: proyecto en desarrollo. Algunas funciones, especialmente ShotVision, son experimentales y necesitan validación con datos reales.

## Funciones

- Registro e inicio de sesión con Supabase.
- Gestión de campos, hoyos y coordenadas GPS.
- Seguimiento de rondas, golpes, putts, calles y GIR.
- Estadísticas y evolución del jugador.
- Configuración de distancias por palo.
- Herramientas experimentales para analizar golpes y putts desde vídeo.

## Requisitos

- Node.js LTS y npm.
- Expo Go o un *development build* compatible.
- Un proyecto propio de Supabase con sus políticas de acceso configuradas.

## Instalación

```bash
git clone https://github.com/mqmf18r/golf-tracker.git
cd golf-tracker
npm install
```

Copia el archivo de ejemplo y añade la URL y la clave **publicable** de tu propio proyecto Supabase:

```powershell
Copy-Item .env.example .env
```

```env
EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
EXPO_PUBLIC_SUPABASE_KEY=your_supabase_publishable_key
```

No utilices una clave `service_role` en una aplicación móvil. Las variables con prefijo `EXPO_PUBLIC_` quedan incluidas en el cliente y deben considerarse públicas; la protección de datos depende de autenticación y de políticas RLS correctas.

## Ejecutar

```bash
npm start
```

También puedes utilizar:

```bash
npm run android
npm run ios
npm run typecheck
```

## Estructura

- `app/`: pantallas y rutas de Expo Router.
- `src/`: componentes, contexto, servicios, almacenamiento y lógica de dominio.
- `assets/`: imágenes y recursos de la aplicación.
- `shotvision-lab/`: experimentos auxiliares de visión artificial.
- `SHOTVISION_PLAN.md`: diseño y planificación de ShotVision.

Los diseños electrónicos OpenFlight y los repositorios externos no forman parte de este repositorio; se mantienen como proyectos independientes con sus propias licencias.

## Seguridad

- `.env` está excluido de Git.
- Solo `.env.example`, sin credenciales reales, se versiona.
- No publiques tokens, claves administrativas, datos de usuarios ni vídeos privados.
- Revisa las políticas Row Level Security de Supabase antes de utilizar datos reales.

## Colaborar

Las incidencias, propuestas y *pull requests* son bienvenidos. Describe cómo reproducir el problema y, si afecta a ShotVision, incluye información de cámara y condiciones de grabación sin compartir datos personales.

## Licencia

Publicado bajo la [licencia MIT](LICENSE).
