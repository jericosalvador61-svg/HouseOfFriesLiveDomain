(function () {
  function uuid() {
    return (crypto.randomUUID ? crypto.randomUUID() :
      'd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
  }
  if (!localStorage.getItem('hof_device_id')) localStorage.setItem('hof_device_id', uuid());

  window.HOFDevice = {
    id: () => localStorage.getItem('hof_device_id'),
    orders: () => JSON.parse(localStorage.getItem('hof_orders') || '[]'),
    addOrder(o) {
      const list = this.orders();
      const existing = list.find(x => x.order_id == o.order_id);
      if (existing) {
        Object.assign(existing, o);
      } else {
        list.unshift(o);
      }
      localStorage.setItem('hof_orders', JSON.stringify(list.slice(0, 20)));
    },
    updateStatus(orderId, status, paid) {
      const list = this.orders().map(x =>
        x.order_id == orderId ? { ...x, status, paid: paid ?? x.paid } : x);
      localStorage.setItem('hof_orders', JSON.stringify(list));
    },
    activeCount() { return this.orders().filter(x => !['SERVED','CANCELLED','COMPLETED'].includes(x.status)).length; }
  };
})();