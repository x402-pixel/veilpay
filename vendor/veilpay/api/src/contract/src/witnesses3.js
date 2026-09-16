export const createVeilPay3PrivateState = (merchantSecretKey, receiptSecret, invoiceOpenings = {}) => ({ merchantSecretKey, receiptSecret, invoiceOpenings });
export const withInvoiceOpening3 = (state, invoiceId, opening) => ({
    ...state,
    invoiceOpenings: { ...state.invoiceOpenings, [invoiceId.toString()]: opening },
});
export const witnesses3 = {
    merchantSecretKey: ({ privateState, }) => [
        privateState,
        privateState.merchantSecretKey,
    ],
    receiptSecret: ({ privateState, }) => [
        privateState,
        privateState.receiptSecret,
    ],
    invoiceOpening: ({ privateState }, invoiceId) => {
        const opening = privateState.invoiceOpenings[invoiceId.toString()];
        if (opening === undefined) {
            throw new Error(`No invoice opening known for invoice ${invoiceId}`);
        }
        return [privateState, opening];
    },
};
//# sourceMappingURL=witnesses3.js.map