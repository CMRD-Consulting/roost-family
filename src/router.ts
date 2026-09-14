import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: { template: '<p class="p-10 text-2xl">roost family</p>' } }],
})
