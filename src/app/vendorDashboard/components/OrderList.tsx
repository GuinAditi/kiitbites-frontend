"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Order } from "../types";
import { OrderCard, LocalStatus } from "./OrderCard";
import styles from "../styles/OrderList.module.scss";

const VENDOR_ID = "6834622e10d75a5ba7b7740d";
const BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "";
const PAGE_SIZE = 5; // number of orders per page
const REFRESH_INTERVAL = 30000; // 30 seconds

type OrderState = {
  order: Order;
  localStatus: LocalStatus;
};

interface ApiOrder {
  orderId: string;
  orderNumber: string;
  orderType: string;
  status: string;
  createdAt: string;
  collectorName: string;
  collectorPhone: string;
  address?: string;
  total: number;
  items: Array<{
    name: string;
    price: number;
    unit: string;
    type: string;
    quantity: number;
  }>;
}

interface OrderListProps {
  onLoaded?: (vendorName: string, vendorId: string) => void;
  onOrderStatusChange?: (orderId: string, newStatus: string, orderData?: Order) => void;
  orderStatusChanges?: {
    orderId: string;
    newStatus: string;
    orderData?: Order;
  }[];
}

export const OrderList: React.FC<OrderListProps> = ({ onLoaded, onOrderStatusChange, orderStatusChanges }) => {
  const [list, setList] = useState<OrderState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const fetchOrders = useCallback(async () => {
    setError(null);
    try {
      const fetchType = async (type: Order["orderType"]) => {
        const res = await fetch(`${BASE}/order/active/${VENDOR_ID}/${type}`);
        if (!res.ok) throw new Error(`Failed to load ${type}`);
        return res.json(); // response includes vendorId, vendorName, orders
      };

      const [delRes, takeRes, dineRes, cashRes] = await Promise.all([
        fetchType("delivery"),
        fetchType("takeaway"),
        fetchType("dinein"),
        fetchType("cash"),
      ]);

      // Call onLoaded using any one of the responses
      if (onLoaded) {
        const vendorName =
          delRes.vendorName || takeRes.vendorName || dineRes.vendorName || cashRes.vendorName;
        const vendorId =
          delRes.vendorId || takeRes.vendorId || dineRes.vendorId || cashRes.vendorId;
        if (vendorName && vendorId) onLoaded(vendorName, vendorId);
      }

      // Combine all orders from the four responses
      const allOrders = [
        ...delRes.orders,
        ...takeRes.orders,
        ...dineRes.orders,
        ...cashRes.orders,
      ];

      // Filter out delivery orders that are on the way (they'll be shown in separate delivery section)
      const filteredOrders = allOrders.filter((order: ApiOrder) => {
        if (order.orderType === "delivery" && order.status === "onTheWay") {
          return false; // Exclude delivery orders that are on the way
        }
        return true; // Include all other orders
      });

      const combined: OrderState[] = filteredOrders.map((o) => ({
        order: o,
        localStatus: mapToLocal(o.status),
      }));

      setList(combined);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'An unknown error occurred');
    }
  }, [onLoaded]);

  // Load once + auto-refresh
  useEffect(() => {
    setLoading(true);
    fetchOrders().finally(() => setLoading(false));
    const interval = setInterval(fetchOrders, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  // Handle incoming order status changes
  useEffect(() => {
    if (orderStatusChanges && orderStatusChanges.length > 0) {
      orderStatusChanges.forEach(change => {
        if (change.newStatus === "onTheWay") {
          console.log(`OrderList: Removing order ${change.orderId} from active orders (status: ${change.newStatus})`);
          // Remove order from active orders list when it becomes onTheWay
          setList(prev => prev.filter(os => os.order.orderId !== change.orderId));
        }
      });
    }
  }, [orderStatusChanges]);

  const advance = (orderId: string, next: LocalStatus | "delivered") => {
    // Find the order being updated
    const orderToUpdate = list.find(os => os.order.orderId === orderId);
    
    setList(
      (prev) =>
        prev
          .map((os) => {
            if (os.order.orderId !== orderId) return os;
            if (next === "delivered") return null;
            return { ...os, localStatus: next as LocalStatus };
          })
          .filter(Boolean) as OrderState[]
    );

    // Notify parent component about the status change
    if (onOrderStatusChange && orderToUpdate) {
      onOrderStatusChange(orderId, next, orderToUpdate.order);
    }

    const endpoint =
      next === "delivered"
        ? `/order/${orderId}/deliver`
        : next === "onTheWay"
        ? `/order/${orderId}/onTheWay`
        : `/order/${orderId}/complete`;

    fetch(`${BASE}${endpoint}`, { method: "PATCH" }).catch((err) => {
      console.error("Failed to PATCH", endpoint, err);
    });
  };

  const totalPages = Math.ceil(list.length / PAGE_SIZE);
  const currentPageList = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) return <p className={styles.empty}>Loading orders…</p>;
  if (error) return <p className={styles.empty}>Error: {error}</p>;
  if (list.length === 0)
    return <p className={styles.empty}>No active orders.</p>;

  return (
    <div className={styles.wrap}>
      {currentPageList.map((os) => (
        <OrderCard
          key={os.order.orderId}
          order={os.order}
          localStatus={os.localStatus}
          onAdvance={advance}
        />
      ))}

      {/* Pagination */}
      <div className={styles.pagination}>
        <button
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
          className={styles.pageButton}
        >
          ◀ Prev
        </button>
        <span className={styles.pageIndicator}>
          Page {page} of {totalPages}
        </span>
        <button
          disabled={page === totalPages}
          onClick={() => setPage((p) => p + 1)}
          className={styles.pageButton}
        >
          Next ▶
        </button>
      </div>
    </div>
  );
};

function mapToLocal(status: string): LocalStatus {
  switch (status) {
    case "inProgress":
      return "inProgress";
    case "ready":
    case "completed":
      return "ready";
    case "onTheWay":
      return "onTheWay";
    default:
      return "inProgress";
  }
}
