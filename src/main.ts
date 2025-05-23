import { createApp } from "vue";
import "./index.css";
import "reset.css";
import App from "./App.vue";

import TDesign from "tdesign-vue-next";
import "tdesign-vue-next/es/style/index.css";

const app = createApp(App);
app.use(TDesign);
app.mount("#app");
