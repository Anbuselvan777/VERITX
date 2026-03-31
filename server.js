const app = require("./backend/app");

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`VERITX listening on http://localhost:${port}`);
});
