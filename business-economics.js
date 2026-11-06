"use strict";

const businessEconomics = {
  "見積もり催促・追客管理": {
    price: 1480,
    fixed: 4000,
    variable: 100,
    initial: 12000,
    scenarios: [0, 2, 5],
    note: "対象訪問100件、購入率0%・2%・5%の条件別試算。費用は計画枠。購入率・販売実績は未計測。"
  }
};

function projectEconomics({price, fixed, variable, scenarios}) {
  const contribution = price - variable;
  return {
    breakEven: contribution > 0 ? Math.ceil(fixed / contribution) : null,
    scenarios: scenarios.map(count => ({
      count,
      revenue: price * count,
      cost: fixed + variable * count,
      profit: contribution * count - fixed
    }))
  };
}
