import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Industry } from "../state.js";
import type { CrmDatabase } from "../db/crm-db.js";

export function createCrmTools(db: CrmDatabase) {
  const findCustomerByName = tool(
    async ({ name }) => {
      const result = await db
        .prepare(`SELECT id, name, industry FROM customers WHERE LOWER(name) LIKE LOWER(?)`)
        .bind(`%${name}%`)
        .all();
      return JSON.stringify({ items: result.results, count: result.results?.length ?? 0 });
    },
    {
      name: "find_customer_by_name",
      description: "Find CRM customers by (partial) name to discover their IDs before reading detailed data.",
      schema: z.object({ name: z.string().describe("Partial or full customer name to search") }),
    }
  );

  const getCustomerData = tool(
    async ({ customer_id }) => {
      const customer = await db
        .prepare(`SELECT id, name, industry FROM customers WHERE id = ?`)
        .bind(customer_id)
        .first();
      if (!customer) return JSON.stringify({ error: "Customer not found" });
      const orders = await db
        .prepare(`SELECT id, status, total FROM orders WHERE customer_id = ?`)
        .bind(customer_id)
        .all();
      return JSON.stringify({ ...customer, orders: orders.results });
    },
    {
      name: "get_customer_data",
      description: "Fetch customer profile and orders from the CRM by customer id.",
      schema: z.object({ customer_id: z.string().describe("The customer ID, e.g. cust-001") }),
    }
  );

  const updateOrderStatus = tool(
    async ({ order_id, status }) => {
      const existing = await db
        .prepare(`SELECT id FROM orders WHERE id = ?`)
        .bind(order_id)
        .first();
      if (!existing) return JSON.stringify({ error: "Order not found" });
      await db
        .prepare(`UPDATE orders SET status = ? WHERE id = ?`)
        .bind(status, order_id)
        .run();
      return JSON.stringify({ ok: true, order_id, status });
    },
    {
      name: "update_order_status",
      description: "Update the status of an order (e.g. pending, shipped, cancelled).",
      schema: z.object({
        order_id: z.string().describe("The order ID"),
        status: z.string().describe("New status value"),
      }),
    }
  );

  const createLead = tool(
    async ({ name, email, industry, notes }) => {
      const id = `lead-${Date.now()}`;
      await db
        .prepare(`INSERT INTO leads (id, name, email, industry, notes) VALUES (?, ?, ?, ?, ?)`)
        .bind(id, name, email, industry ?? null, notes ?? null)
        .run();
      return JSON.stringify({ id, lead: { id, name, email, industry, notes } });
    },
    {
      name: "create_lead",
      description: "Create a sales lead in the CRM.",
      schema: z.object({
        name: z.string(),
        email: z.string(),
        industry: z.string().optional().describe("Industry of the lead"),
        notes: z.string().optional().describe("Additional notes"),
      }),
    }
  );

  const deleteCustomerRecord = tool(
    async ({ customer_id }) => {
      const existing = await db
        .prepare(`SELECT id, name, industry FROM customers WHERE id = ?`)
        .bind(customer_id)
        .first();
      if (!existing) return JSON.stringify({ error: "Customer not found" });
      await db.prepare(`DELETE FROM orders WHERE customer_id = ?`).bind(customer_id).run();
      await db.prepare(`DELETE FROM customers WHERE id = ?`).bind(customer_id).run();
      return JSON.stringify({ ok: true, deleted_id: customer_id, snapshot: existing });
    },
    {
      name: "delete_customer_record",
      description: "Permanently delete a customer record from the CRM. Requires human approval.",
      schema: z.object({ customer_id: z.string().describe("Customer ID to delete") }),
    }
  );

  return { findCustomerByName, getCustomerData, updateOrderStatus, createLead, deleteCustomerRecord };
}

export const CRITICAL_TOOL_NAMES = new Set(["delete_customer_record"]);

export function getToolsForIndustry(industry: Industry, db: CrmDatabase) {
  const t = createCrmTools(db);
  const allTools = [t.findCustomerByName, t.getCustomerData, t.updateOrderStatus, t.createLead, t.deleteCustomerRecord];
  const safeTools = [t.findCustomerByName, t.getCustomerData, t.updateOrderStatus, t.createLead];

  if (industry === "unknown") return safeTools;
  return allTools;
}
