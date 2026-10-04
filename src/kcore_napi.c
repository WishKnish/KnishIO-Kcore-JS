/*
 * N-API binding of kcore (KnishIO-Crypto-Core), statically linked. One wrapper per kcore entry point;
 * Uint8Array (Buffer included) in, Buffer out. Argument checks throw before kcore runs; a kcore -1
 * throws afterwards. Every error carries a code:
 *   KCORE_BAD_ARG   TypeError: wrong type or length
 *   KCORE_BAD_SET   RangeError: ML-KEM parameter set other than 1024 or 768
 *   KCORE_REJECTED  Error: kcore returned -1 (counts out of range, NUL in hex, failed key check)
 *
 *   abiVersion() -> number
 *   shake256(in, outLen) -> Buffer
 *   chainsHex(asciiChunks, Int32Array counts) -> Buffer (a new copy; 4-way Keccak)
 *   wotsAddress(asciiKey2048) -> Buffer (64 hex bytes)
 *   mlkemKeypair(set, seed64) -> [pk, sk]
 *   mlkemEncaps(set, pk, coins32) -> [ct, ss]
 *   mlkemDecaps(set, ct, sk) -> ss
 */
#define NAPI_VERSION 8
#include <node_api.h>
#include <stdint.h>
#include <string.h>

#include "kcore.h"

#ifdef _WIN32
/* On Windows the addon imports nothing from a DLL named NODE.EXE. Such an import breaks in a host
 * executable with another name (Electron, pkg, a renamed node.exe): Windows resolves it by searching
 * for node.exe, may load a second, uninitialised copy from PATH, and the addon then calls into that
 * copy. Instead every napi_* entry point the addon uses is resolved once, at module init, from the
 * host process itself (GetModuleHandle(NULL)), which is the executable that loaded the addon and
 * exports Node-API. If the host does not export them, init returns NULL and the package falls back
 * to its WASM backend. The build links no node.exe import library, so a napi_* call that bypassed
 * this table would fail to link. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#define KN_NAPI_FNS(X)                                                                         \
    X(napi_create_array_with_length) X(napi_create_buffer) X(napi_create_int32)                 \
    X(napi_define_properties) X(napi_get_cb_info) X(napi_get_typedarray_info)                    \
    X(napi_get_value_int32) X(napi_get_value_int64) X(napi_is_typedarray) X(napi_set_element)    \
    X(napi_throw_error) X(napi_throw_range_error) X(napi_throw_type_error)

#define KN_PTR(f) static __typeof__(f) *kn_##f;
KN_NAPI_FNS(KN_PTR)

/* 0 when every entry point resolved from the host executable. */
static int kn_resolve_host(void) {
    HMODULE host = GetModuleHandleW(NULL);
    if (host == NULL) return -1;
#define KN_GET(f) \
    if ((kn_##f = (__typeof__(f) *)(void (*)(void))GetProcAddress(host, #f)) == NULL) return -1;
    KN_NAPI_FNS(KN_GET)
    return 0;
}

#define napi_create_array_with_length (*kn_napi_create_array_with_length)
#define napi_create_buffer (*kn_napi_create_buffer)
#define napi_create_int32 (*kn_napi_create_int32)
#define napi_define_properties (*kn_napi_define_properties)
#define napi_get_cb_info (*kn_napi_get_cb_info)
#define napi_get_typedarray_info (*kn_napi_get_typedarray_info)
#define napi_get_value_int32 (*kn_napi_get_value_int32)
#define napi_get_value_int64 (*kn_napi_get_value_int64)
#define napi_is_typedarray (*kn_napi_is_typedarray)
#define napi_set_element (*kn_napi_set_element)
#define napi_throw_error (*kn_napi_throw_error)
#define napi_throw_range_error (*kn_napi_throw_range_error)
#define napi_throw_type_error (*kn_napi_throw_type_error)
#endif

#define BAD_ARG(env, msg) do { napi_throw_type_error((env), "KCORE_BAD_ARG", (msg)); return NULL; } while (0)
#define REJECTED(env, fn) do { napi_throw_error((env), "KCORE_REJECTED", fn " rejected its arguments"); return NULL; } while (0)

struct mlkem_set {
    size_t pk, sk, ct;
    int (*keypair)(const uint8_t *, uint8_t *, uint8_t *);
    int (*encaps)(const uint8_t *, const uint8_t *, uint8_t *, uint8_t *);
    int (*decaps)(const uint8_t *, const uint8_t *, uint8_t *);
};

static const struct mlkem_set MLKEM1024 = {KCORE_MLKEM1024_PK, KCORE_MLKEM1024_SK, KCORE_MLKEM1024_CT,
                                           kcore_mlkem1024_keypair, kcore_mlkem1024_encaps, kcore_mlkem1024_decaps};
static const struct mlkem_set MLKEM768 = {KCORE_MLKEM768_PK, KCORE_MLKEM768_SK, KCORE_MLKEM768_CT,
                                          kcore_mlkem768_keypair, kcore_mlkem768_encaps, kcore_mlkem768_decaps};

/* 0 when v is a Uint8Array (or Buffer); fills its data pointer and byte length. */
static int get_u8(napi_env env, napi_value v, uint8_t **data, size_t *len) {
    bool is;
    napi_typedarray_type type;
    napi_value ab;
    size_t off;
    void *p;
    if (napi_is_typedarray(env, v, &is) != napi_ok || !is) return -1;
    if (napi_get_typedarray_info(env, v, &type, len, &p, &ab, &off) != napi_ok || type != napi_uint8_array) return -1;
    *data = p;
    return 0;
}

/* The ML-KEM set named by v, or NULL after throwing. */
static const struct mlkem_set *get_set(napi_env env, napi_value v) {
    int32_t set;
    if (napi_get_value_int32(env, v, &set) != napi_ok || (set != 1024 && set != 768)) {
        napi_throw_range_error(env, "KCORE_BAD_SET", "parameter set must be 1024 or 768");
        return NULL;
    }
    return set == 1024 ? &MLKEM1024 : &MLKEM768;
}

static napi_value new_buffer(napi_env env, size_t len, uint8_t **data) {
    napi_value out;
    void *p;
    if (napi_create_buffer(env, len, &p, &out) != napi_ok) return NULL;
    *data = p;
    return out;
}

static napi_value pair(napi_env env, napi_value a, napi_value b) {
    napi_value arr;
    if (napi_create_array_with_length(env, 2, &arr) != napi_ok) return NULL;
    if (napi_set_element(env, arr, 0, a) != napi_ok || napi_set_element(env, arr, 1, b) != napi_ok) return NULL;
    return arr;
}

static napi_value js_abi_version(napi_env env, napi_callback_info info) {
    (void)info;
    napi_value out;
    napi_create_int32(env, kcore_abi_version(), &out);
    return out;
}

static napi_value js_shake256(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    uint8_t *in, *out;
    size_t inlen;
    int64_t outlen;
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (argc != 2 || get_u8(env, argv[0], &in, &inlen) != 0) BAD_ARG(env, "shake256(Uint8Array, outLen)");
    if (napi_get_value_int64(env, argv[1], &outlen) != napi_ok || outlen < 1 || outlen > 1048576) {
        BAD_ARG(env, "outLen must be an integer in 1..1048576");
    }
    napi_value res = new_buffer(env, (size_t)outlen, &out);
    if (res == NULL) return NULL;
    if (kcore_shake256(in, inlen, out, (size_t)outlen) != 0) REJECTED(env, "kcore_shake256");
    return res;
}

static napi_value js_chains_hex(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    uint8_t *chunks, *out;
    size_t clen, n, off;
    bool is_ta;
    napi_typedarray_type type;
    void *counts;
    napi_value ab;
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (argc != 2 || get_u8(env, argv[0], &chunks, &clen) != 0) BAD_ARG(env, "chainsHex(Uint8Array, Int32Array)");
    if (napi_is_typedarray(env, argv[1], &is_ta) != napi_ok || !is_ta) BAD_ARG(env, "counts must be an Int32Array");
    if (napi_get_typedarray_info(env, argv[1], &type, &n, &counts, &ab, &off) != napi_ok || type != napi_int32_array) {
        BAD_ARG(env, "counts must be an Int32Array");
    }
    if (n < 1 || n > 64 || clen != n * 128) BAD_ARG(env, "chunks must hold 128 characters per count (1..64 chains)");
    napi_value res = new_buffer(env, clen, &out);
    if (res == NULL) return NULL;
    memcpy(out, chunks, clen);
    if (kcore_chains_hex((char *)out, counts, n, 4) != 0) REJECTED(env, "kcore_chains_hex");
    return res;
}

static napi_value js_wots_address(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    uint8_t *key, *out;
    size_t klen;
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (argc != 1 || get_u8(env, argv[0], &key, &klen) != 0 || klen != 2048) {
        BAD_ARG(env, "wotsAddress(Uint8Array of 2048 hex bytes)");
    }
    napi_value res = new_buffer(env, 64, &out);
    if (res == NULL) return NULL;
    if (kcore_wots_address((const char *)key, (char *)out) != 0) REJECTED(env, "kcore_wots_address");
    return res;
}

static napi_value js_mlkem_keypair(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    uint8_t *seed, *pk, *sk;
    size_t len;
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (argc != 2) BAD_ARG(env, "mlkemKeypair(set, seed)");
    const struct mlkem_set *m = get_set(env, argv[0]);
    if (m == NULL) return NULL;
    if (get_u8(env, argv[1], &seed, &len) != 0 || len != KCORE_MLKEM_SEED) BAD_ARG(env, "seed must be 64 bytes");
    napi_value jpk = new_buffer(env, m->pk, &pk);
    napi_value jsk = new_buffer(env, m->sk, &sk);
    if (jpk == NULL || jsk == NULL) return NULL;
    if (m->keypair(seed, pk, sk) != 0) REJECTED(env, "kcore_mlkem_keypair");
    return pair(env, jpk, jsk);
}

static napi_value js_mlkem_encaps(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value argv[3];
    uint8_t *pk, *coins, *ct, *ss;
    size_t pklen, clen;
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (argc != 3) BAD_ARG(env, "mlkemEncaps(set, publicKey, coins)");
    const struct mlkem_set *m = get_set(env, argv[0]);
    if (m == NULL) return NULL;
    if (get_u8(env, argv[1], &pk, &pklen) != 0 || pklen != m->pk) BAD_ARG(env, "public key has the wrong length");
    if (get_u8(env, argv[2], &coins, &clen) != 0 || clen != KCORE_MLKEM_COINS) BAD_ARG(env, "coins must be 32 bytes");
    napi_value jct = new_buffer(env, m->ct, &ct);
    napi_value jss = new_buffer(env, KCORE_MLKEM_SS, &ss);
    if (jct == NULL || jss == NULL) return NULL;
    if (m->encaps(pk, coins, ct, ss) != 0) REJECTED(env, "kcore_mlkem_encaps");
    return pair(env, jct, jss);
}

static napi_value js_mlkem_decaps(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value argv[3];
    uint8_t *ct, *sk, *ss;
    size_t ctlen, sklen;
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (argc != 3) BAD_ARG(env, "mlkemDecaps(set, cipherText, secretKey)");
    const struct mlkem_set *m = get_set(env, argv[0]);
    if (m == NULL) return NULL;
    if (get_u8(env, argv[1], &ct, &ctlen) != 0 || ctlen != m->ct) BAD_ARG(env, "ciphertext has the wrong length");
    if (get_u8(env, argv[2], &sk, &sklen) != 0 || sklen != m->sk) BAD_ARG(env, "secret key has the wrong length");
    napi_value jss = new_buffer(env, KCORE_MLKEM_SS, &ss);
    if (jss == NULL) return NULL;
    if (m->decaps(ct, sk, ss) != 0) REJECTED(env, "kcore_mlkem_decaps");
    return jss;
}

NAPI_MODULE_INIT() {
#ifdef _WIN32
    if (kn_resolve_host() != 0) return NULL;
#endif
    napi_property_descriptor props[] = {
        {"abiVersion", NULL, js_abi_version, NULL, NULL, NULL, napi_default, NULL},
        {"shake256", NULL, js_shake256, NULL, NULL, NULL, napi_default, NULL},
        {"chainsHex", NULL, js_chains_hex, NULL, NULL, NULL, napi_default, NULL},
        {"wotsAddress", NULL, js_wots_address, NULL, NULL, NULL, napi_default, NULL},
        {"mlkemKeypair", NULL, js_mlkem_keypair, NULL, NULL, NULL, napi_default, NULL},
        {"mlkemEncaps", NULL, js_mlkem_encaps, NULL, NULL, NULL, napi_default, NULL},
        {"mlkemDecaps", NULL, js_mlkem_decaps, NULL, NULL, NULL, napi_default, NULL},
    };
    if (napi_define_properties(env, exports, sizeof props / sizeof props[0], props) != napi_ok) return NULL;
    return exports;
}
