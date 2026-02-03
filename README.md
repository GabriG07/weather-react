# Previsão do Tempo (React)

Aplicação web de previsão do tempo com busca de cidades, geolocalização, favoritos e gráficos, consumindo a API do Open-Meteo.

---

## Funcionalidades

- Busca de cidades com autocomplete (geocoding)
- Uso da localização atual do usuário
- Favoritar cidades e alternar rapidamente entre elas
- Persistência no LocalStorage (favoritos, última cidade e preferências)
- Alternância de tema claro/escuro
- Alternância de unidades (Celsius / Fahrenheit)
- Gráfico horário de temperatura e chance de chuva
- Previsão diária de até 7 dias
- Estados de carregamento (skeleton) e erro com retry

---

## Tecnologias

- React (hooks)
- TailwindCSS
- Framer Motion
- Recharts
- Open-Meteo API
- OpenStreetMap Nominatim (reverse geocoding)

---

## Decisões técnicas

- Uso de debounce na busca de cidades para reduzir chamadas à API.
- Persistência com LocalStorage para manter preferências e favoritos entre sessões.
- Fallback de localização caso o reverse geocoding falhe.
- Normalização dos dados de geocoding para reduzir acoplamento ao formato das APIs externas.


---

## Como rodar o projeto

```bash
npm install
npm run dev
